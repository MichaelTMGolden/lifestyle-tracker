using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;

namespace PersonalDashboard.Api.Nutrition;

/// <summary>
/// Server-side proxy over the free food databases we "rent" instead of building.
/// Open Food Facts (branded/packaged, no key) and USDA FoodData Central (generic
/// whole foods, free key) are normalized into one <see cref="FoodSearchResult"/>
/// shape. Calls run from the server so the USDA key stays server-side and we
/// control the User-Agent / rate-limiting / normalization.
///
/// Resilient by design: each source is wrapped so one upstream failing (timeout,
/// 5xx, missing key) yields partial results rather than failing the whole search.
///
/// Barcode lookup is intentionally not implemented yet, but the shape is built
/// for it — a <c>LookupByBarcodeAsync(code)</c> hitting the OFF product-by-barcode
/// endpoint would return the same <see cref="FoodSearchResult"/> with no caller
/// changes (see the stub at the bottom).
/// </summary>
public class FoodSearchService
{
    private readonly IHttpClientFactory _http;
    private readonly IConfiguration _config;
    private readonly IMemoryCache _cache;
    private readonly ILogger<FoodSearchService> _log;

    public FoodSearchService(IHttpClientFactory http, IConfiguration config, IMemoryCache cache, ILogger<FoodSearchService> log)
    {
        _http = http; _config = config; _cache = cache; _log = log;
    }

    public async Task<List<FoodSearchResult>> SearchAsync(string query, string country, CancellationToken ct = default)
    {
        query = (query ?? "").Trim();
        if (query.Length < 2) return new();
        country = string.IsNullOrWhiteSpace(country) ? "ie" : country.Trim().ToLowerInvariant();

        var cacheKey = $"food:{country}:{query.ToLowerInvariant()}";
        if (_cache.TryGetValue(cacheKey, out List<FoodSearchResult>? cached) && cached is not null)
            return cached;

        // Hit both sources concurrently; a failure in one returns [] (not a throw).
        var usdaTask = SafeAsync(() => SearchUsdaAsync(query, ct), "USDA");
        var offTask = SafeAsync(() => SearchOpenFoodFactsAsync(query, country, ct), "OpenFoodFacts");
        await Task.WhenAll(usdaTask, offTask);

        // USDA generic reference foods first (clean staples; unbranded before branded),
        // then Open Food Facts branded/packaged hits.
        var merged = new List<FoodSearchResult>();
        merged.AddRange(usdaTask.Result.OrderBy(r => r.Brand is not null));
        merged.AddRange(offTask.Result);

        _cache.Set(cacheKey, merged, TimeSpan.FromMinutes(10));
        return merged;
    }

    // ---- Future barcode support (design note — deliberately not implemented) ----
    // public async Task<FoodSearchResult?> LookupByBarcodeAsync(string code, CancellationToken ct = default)
    // {
    //     // GET https://world.openfoodfacts.org/api/v2/product/{code}.json → MapOffProduct(...)
    //     throw new NotImplementedException();
    // }

    private async Task<List<FoodSearchResult>> SafeAsync(Func<Task<List<FoodSearchResult>>> fn, string label)
    {
        try { return await fn(); }
        catch (Exception ex) { _log.LogWarning(ex, "Food source {Source} failed", label); return new(); }
    }

    private async Task<List<FoodSearchResult>> SearchOpenFoodFactsAsync(string q, string country, CancellationToken ct)
    {
        var client = _http.CreateClient("off");
        // Country subdomain biases local products first (ie.openfoodfacts.org).
        var host = $"https://{country}.openfoodfacts.org";
        var url = $"{host}/cgi/search.pl?search_terms={Uri.EscapeDataString(q)}&search_simple=1&action=process&json=1&page_size=15"
                + "&fields=product_name,brands,code,serving_size,nutriments";

        using var resp = await client.GetAsync(url, ct);
        resp.EnsureSuccessStatusCode();
        await using var stream = await resp.Content.ReadAsStreamAsync(ct);
        using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);

        var results = new List<FoodSearchResult>();
        if (!doc.RootElement.TryGetProperty("products", out var products) || products.ValueKind != JsonValueKind.Array)
            return results;

        foreach (var p in products.EnumerateArray())
        {
            var name = GetStr(p, "product_name");
            if (string.IsNullOrWhiteSpace(name)) continue;
            if (!p.TryGetProperty("nutriments", out var n) || n.ValueKind != JsonValueKind.Object) continue;

            var per100 = new MacroSet(
                GetNum(n, "energy-kcal_100g"),
                GetNum(n, "proteins_100g"),
                GetNum(n, "carbohydrates_100g"),
                GetNum(n, "fat_100g"));
            if (per100 is { Kcal: <= 0, Protein: <= 0, Carbs: <= 0, Fat: <= 0 }) continue;

            // OFF stores minerals in grams → convert to mg (×1000).
            var micro100 = new MicroSet(
                GetNum(n, "fiber_100g"), GetNum(n, "sugars_100g"), GetNum(n, "saturated-fat_100g"),
                GetNum(n, "sodium_100g") * 1000, GetNum(n, "potassium_100g") * 1000,
                GetNum(n, "calcium_100g") * 1000, GetNum(n, "iron_100g") * 1000);

            MacroSet? perServing = null;
            MicroSet? microServing = null;
            var servKcal = GetNum(n, "energy-kcal_serving");
            if (servKcal > 0)
            {
                perServing = new MacroSet(servKcal, GetNum(n, "proteins_serving"), GetNum(n, "carbohydrates_serving"), GetNum(n, "fat_serving"));
                microServing = new MicroSet(
                    GetNum(n, "fiber_serving"), GetNum(n, "sugars_serving"), GetNum(n, "saturated-fat_serving"),
                    GetNum(n, "sodium_serving") * 1000, GetNum(n, "potassium_serving") * 1000,
                    GetNum(n, "calcium_serving") * 1000, GetNum(n, "iron_serving") * 1000);
            }

            results.Add(new FoodSearchResult(
                name.Trim(), NullIfEmpty(GetStr(p, "brands")), "OpenFoodFacts",
                NullIfEmpty(GetStr(p, "code")), NullIfEmpty(GetStr(p, "serving_size")), per100, perServing, micro100, microServing));
        }
        return results;
    }

    private async Task<List<FoodSearchResult>> SearchUsdaAsync(string q, CancellationToken ct)
    {
        var key = _config["Usda:ApiKey"];
        if (string.IsNullOrWhiteSpace(key)) return new(); // no key configured → skip silently

        var client = _http.CreateClient("usda");
        var url = $"https://api.nal.usda.gov/fdc/v1/foods/search?api_key={key}"
                + $"&query={Uri.EscapeDataString(q)}&pageSize=10&dataType=Foundation,SR%20Legacy,Branded";

        using var resp = await client.GetAsync(url, ct);
        resp.EnsureSuccessStatusCode();
        await using var stream = await resp.Content.ReadAsStreamAsync(ct);
        using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);

        var results = new List<FoodSearchResult>();
        if (!doc.RootElement.TryGetProperty("foods", out var foods) || foods.ValueKind != JsonValueKind.Array)
            return results;

        foreach (var f in foods.EnumerateArray())
        {
            var name = GetStr(f, "description");
            if (string.IsNullOrWhiteSpace(name)) continue;

            double kcal = 0, pro = 0, carb = 0, fat = 0;
            double fiber = 0, sugar = 0, satFat = 0, sodium = 0, potassium = 0, calcium = 0, iron = 0;
            if (f.TryGetProperty("foodNutrients", out var fns) && fns.ValueKind == JsonValueKind.Array)
            {
                foreach (var fn in fns.EnumerateArray())
                {
                    var val = GetNum(fn, "value");
                    switch (GetStr(fn, "nutrientNumber")) // USDA per-100g standard numbers (minerals in mg)
                    {
                        case "208": kcal = val; break;
                        case "203": pro = val; break;
                        case "205": carb = val; break;
                        case "204": fat = val; break;
                        case "291": fiber = val; break;
                        case "269": sugar = val; break;
                        case "606": satFat = val; break;
                        case "307": sodium = val; break;
                        case "306": potassium = val; break;
                        case "301": calcium = val; break;
                        case "303": iron = val; break;
                    }
                }
            }
            if (kcal <= 0 && pro <= 0 && carb <= 0 && fat <= 0) continue;

            var per100 = new MacroSet(kcal, pro, carb, fat);
            var micro100 = new MicroSet(fiber, sugar, satFat, sodium, potassium, calcium, iron);
            MacroSet? perServing = null;
            MicroSet? microServing = null;
            string? servDesc = null;
            var servSize = GetNum(f, "servingSize");
            if (servSize > 0)
            {
                var r = servSize / 100.0;
                perServing = new MacroSet(kcal * r, pro * r, carb * r, fat * r);
                microServing = new MicroSet(fiber * r, sugar * r, satFat * r, sodium * r, potassium * r, calcium * r, iron * r);
                servDesc = $"{servSize:0.#} {GetStr(f, "servingSizeUnit")}".Trim();
            }
            var fdcId = f.TryGetProperty("fdcId", out var idEl) ? idEl.ToString() : null;
            results.Add(new FoodSearchResult(
                name.Trim(), NullIfEmpty(GetStr(f, "brandName")), "Usda", fdcId, servDesc, per100, perServing, micro100, microServing));
        }
        return results;
    }

    // ---- JSON helpers (OFF nutriments come as numbers OR strings) ----
    private static double GetNum(JsonElement obj, string prop)
    {
        if (!obj.TryGetProperty(prop, out var v)) return 0;
        if (v.ValueKind == JsonValueKind.Number) return v.GetDouble();
        if (v.ValueKind == JsonValueKind.String &&
            double.TryParse(v.GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var d)) return d;
        return 0;
    }

    private static string GetStr(JsonElement obj, string prop) =>
        obj.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";

    private static string? NullIfEmpty(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
