namespace PersonalDashboard.Api.Nutrition;

/// <summary>A set of macros — used both per-100g and (optionally) per-serving.</summary>
public record MacroSet(double Kcal, double Protein, double Carbs, double Fat);

/// <summary>
/// Detailed nutrients beyond the four macros. g for fibre/sugar/sat-fat; mg for
/// the minerals. Parallel to <see cref="MacroSet"/> (per-100g and per-serving).
/// </summary>
public record MicroSet(
    double FiberG, double SugarG, double SatFatG,
    double SodiumMg, double PotassiumMg, double CalciumMg, double IronMg)
{
    public static readonly MicroSet Zero = new(0, 0, 0, 0, 0, 0, 0);
}

/// <summary>
/// One normalized food-search hit. Both Open Food Facts and USDA are flattened
/// into this single shape so callers never branch on the upstream source.
/// <c>Source</c> is a <see cref="Domain.SourceKind"/> name ("OpenFoodFacts" /
/// "Usda") so the client can echo it straight back when logging an entry.
/// </summary>
public record FoodSearchResult(
    string Name,
    string? Brand,
    string Source,
    string? ExternalRef,        // OFF barcode or USDA fdcId — also the future barcode/dedupe key
    string? ServingDescription, // "30 g", "1 cup", ...
    MacroSet Per100g,
    MacroSet? PerServing,
    MicroSet MicrosPer100g,
    MicroSet? MicrosPerServing);
