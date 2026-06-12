"""
Garmin sidecar — a tiny FastAPI service the .NET API calls to scrape Garmin
Connect (which has no server-usable API). Runs alongside the API (same container
on Render, or standalone) and is reachable only on localhost / behind a shared
token. The .NET side owns the database; this just fetches and returns samples.
"""
from __future__ import annotations
import os

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

from garmin_client import pull

app = FastAPI(title="Garmin sidecar")
TOKEN = os.environ.get("SIDECAR_TOKEN")


def _auth(token: str | None):
    # When SIDECAR_TOKEN is set, require it. (In-container the API passes it.)
    if TOKEN and token != TOKEN:
        raise HTTPException(status_code=401, detail="bad sidecar token")


class PullRequest(BaseModel):
    email: str
    password: str
    days: int = 14
    end: str | None = None


@app.get("/health")
def health():
    return {"status": "ok", "service": "garmin-sidecar"}


@app.post("/pull")
def do_pull(req: PullRequest, x_sidecar_token: str | None = Header(default=None)):
    _auth(x_sidecar_token)
    try:
        samples = pull(req.email, req.password, req.days, req.end)
    except Exception as e:  # surface login / fetch failures to the caller
        raise HTTPException(status_code=502, detail=f"garmin pull failed: {e}")
    return {"count": len(samples), "samples": samples}
