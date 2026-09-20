"""API contract tests.

What these protect: the shapes the frontend depends on, the validation that
keeps nonsense out of the model, and — most importantly — the promise that the
service never fabricates a number when the model is unavailable.
"""
from __future__ import annotations

import pytest


class TestSystem:
    def test_root(self, client):
        response = client.get("/")
        assert response.status_code == 200
        assert "version" in response.json()

    def test_health_reports_artifact_state(self, client):
        response = client.get("/health")
        assert response.status_code in (200, 503)
        body = response.json()
        assert body["status"] in ("ok", "degraded")
        assert isinstance(body["models"], list)
        assert isinstance(body["problems"], list)

    def test_openapi_schema_is_served(self, client):
        response = client.get("/openapi.json")
        assert response.status_code == 200
        assert "/api/predict/heat" in response.json()["paths"]

    def test_every_response_carries_a_request_id(self, client):
        response = client.get("/health")
        assert response.headers.get("x-request-id")
        assert response.headers.get("x-response-time-ms")

    def test_request_id_is_echoed_when_supplied(self, client):
        response = client.get("/health", headers={"x-request-id": "test-1234"})
        assert response.headers["x-request-id"] == "test-1234"


class TestDegradedMode:
    """Without artifacts the service must refuse, clearly, and never guess."""

    def test_prediction_without_a_model_returns_503(self, client, has_models, conditions):
        if has_models:
            pytest.skip("artifacts present — degraded mode is not exercised")
        response = client.post(
            "/api/predict/heat",
            json={"station_id": "725053-94728", "conditions": conditions},
        )
        assert response.status_code == 503
        error = response.json()["error"]
        assert error["code"] == "artifact_unavailable"
        assert "pipeline" in error["message"].lower()


class TestMetadata:
    def test_meta(self, client, requires_models):
        body = client.get("/api/meta").json()
        assert body["network"]["stations"] > 50
        assert len(body["data_sources"]) >= 3
        assert body["split_strategy"]["type"] == "chronological"

    def test_models_lists_every_candidate(self, client, requires_models):
        body = client.get("/api/models?task=heat").json()
        keys = {c["key"] for c in body["candidates"]}
        assert {"baseline_mean", "linear", "random_forest", "decision_tree"} <= keys
        assert body["selected"]["key"].startswith("random_forest")

    def test_random_forest_beats_the_mean_baseline(self, client, requires_models):
        body = client.get("/api/models?task=heat").json()
        by_key = {c["key"]: c for c in body["candidates"]}
        assert by_key["random_forest"]["validation"]["r2"] > by_key["baseline_mean"]["validation"]["r2"]

    def test_random_forest_beats_a_single_tree(self, client, requires_models):
        body = client.get("/api/models?task=heat").json()
        by_key = {c["key"]: c for c in body["candidates"]}
        assert by_key["random_forest"]["validation"]["rmse"] < by_key["decision_tree"]["validation"]["rmse"]

    def test_model_metrics_include_importance(self, client, requires_models):
        body = client.get("/api/model-metrics?task=heat").json()
        assert len(body["feature_importance"]) > 20
        total = sum(row["importance"] for row in body["feature_importance"])
        assert total == pytest.approx(1.0, abs=0.02)

    def test_feature_ranges_come_from_observed_data(self, client, requires_models):
        body = client.get("/api/features?task=heat").json()
        assert body["count"] > 20
        for feature in body["features"]:
            assert feature["min"] <= feature["p01"] <= feature["median"] <= feature["p99"] <= feature["max"]
        assert any(f["adjustable"] for f in body["features"])

    def test_unknown_task_is_rejected(self, client):
        response = client.get("/api/models?task=weather")
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "invalid_input"

    def test_validation_report_has_no_hard_failures(self, client, requires_models):
        body = client.get("/api/validation").json()
        assert body["failures"] == []
        assert body["passed"] is True


class TestReference:
    def test_sites(self, client, requires_models):
        body = client.get("/api/sites").json()
        assert body["count"] > 50
        site = body["sites"][0]
        assert {"station_id", "name", "lat", "lon", "urban_class", "morphology"} <= set(site)
        assert -90 <= site["lat"] <= 90
        assert -180 <= site["lon"] <= 180

    def test_sites_can_be_filtered_by_class(self, client, requires_models):
        body = client.get("/api/sites?urban_class=urban").json()
        assert body["count"] > 0
        assert all(s["urban_class"] == "urban" for s in body["sites"])

    def test_zones(self, client, has_energy_model):
        if not has_energy_model:
            pytest.skip("energy model not built")
        body = client.get("/api/zones").json()
        assert body["count"] >= 10
        assert all(z["mean_mw"] > 0 for z in body["zones"])


class TestHeatPrediction:
    def test_returns_a_complete_prediction(self, client, station_id, conditions):
        response = client.post(
            "/api/predict/heat",
            json={"station_id": station_id, "conditions": conditions, "explain": True},
        )
        assert response.status_code == 200
        body = response.json()

        prediction = body["prediction"]
        assert -10 < prediction["uhi_intensity_c"] < 15
        assert prediction["site_temperature_c"] == pytest.approx(
            prediction["background_temperature_c"] + prediction["uhi_intensity_c"], abs=0.02
        )
        assert 1 <= prediction["relative_humidity_pct"] <= 100
        assert body["risk"]["band"] in (
            "none", "caution", "extreme-caution", "danger", "extreme-danger")
        assert body["model"]["target"] == "uhi_intensity_c"
        assert body["disclaimer"]

    def test_explanation_is_additive(self, client, station_id, conditions):
        """SHAP values must reconstruct the prediction from the base value."""
        body = client.post(
            "/api/predict/heat",
            json={"station_id": station_id, "conditions": conditions, "explain": True},
        ).json()
        explanation = body["explanation"]
        assert explanation is not None
        total = (
            explanation["base_value"]
            + sum(c["contribution"] for c in explanation["contributions"])
            + explanation["other_features_contribution"]
        )
        assert total == pytest.approx(explanation["prediction"], abs=0.05)

    def test_explanation_can_be_switched_off(self, client, station_id, conditions):
        body = client.post(
            "/api/predict/heat",
            json={"station_id": station_id, "conditions": conditions, "explain": False},
        ).json()
        assert body["explanation"] is None

    def test_contributions_are_ordered_by_magnitude(self, client, station_id, conditions):
        body = client.post(
            "/api/predict/heat",
            json={"station_id": station_id, "conditions": conditions},
        ).json()
        magnitudes = [abs(c["contribution"]) for c in body["explanation"]["contributions"]]
        assert magnitudes == sorted(magnitudes, reverse=True)

    def test_is_deterministic(self, client, station_id, conditions):
        payload = {"station_id": station_id, "conditions": conditions}
        first = client.post("/api/predict/heat", json=payload).json()
        second = client.post("/api/predict/heat", json=payload).json()
        assert first["prediction"] == second["prediction"]

    def test_wind_suppresses_the_anomaly(self, client, station_id, conditions):
        """A physical expectation the model should reproduce, not a code path."""
        calm = client.post("/api/predict/heat", json={
            "station_id": station_id,
            "conditions": {**conditions, "wind_speed_ms": 0.5},
        }).json()["prediction"]["uhi_intensity_c"]
        windy = client.post("/api/predict/heat", json={
            "station_id": station_id,
            "conditions": {**conditions, "wind_speed_ms": 11.0},
        }).json()["prediction"]["uhi_intensity_c"]
        assert windy < calm

    def test_overrides_are_reported_back(self, client, station_id, conditions):
        body = client.post("/api/predict/heat", json={
            "station_id": station_id,
            "conditions": conditions,
            "overrides": {"green_fraction_1km": 0.8},
        }).json()
        assert body["site"]["overridden"]["green_fraction_1km"] == pytest.approx(0.8)
        assert body["site"]["morphology"]["green_fraction_1km"] == pytest.approx(0.8)

    def test_unknown_station_is_404(self, client, requires_models, conditions):
        response = client.post(
            "/api/predict/heat",
            json={"station_id": "000000-00000", "conditions": conditions},
        )
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "not_found"


class TestValidation:
    @pytest.mark.parametrize(
        "bad,field",
        [
            ({"t_ref_c": 120.0}, "t_ref_c"),
            ({"wind_speed_ms": -3.0}, "wind_speed_ms"),
            ({"sky_cover_oktas": 12.0}, "sky_cover_oktas"),
            ({"relative_humidity_pct": 250.0}, "relative_humidity_pct"),
            ({"slp_hpa": 1.0}, "slp_hpa"),
        ],
    )
    def test_out_of_range_inputs_are_rejected(self, client, conditions, bad, field):
        response = client.post("/api/predict/heat", json={
            "station_id": "725053-94728",
            "conditions": {**conditions, **bad},
        })
        assert response.status_code == 422
        body = response.json()["error"]
        assert body["code"] == "validation_error"
        assert any(field in f["field"] for f in body["detail"]["fields"])

    def test_humidity_is_required_in_some_form(self, client):
        response = client.post("/api/predict/heat", json={
            "station_id": "725053-94728",
            "conditions": {"t_ref_c": 24.0, "wind_speed_ms": 1.0},
        })
        assert response.status_code == 422

    def test_dewpoint_above_temperature_is_rejected(self, client):
        response = client.post("/api/predict/heat", json={
            "station_id": "725053-94728",
            "conditions": {"t_ref_c": 10.0, "dewpoint_ref_c": 25.0, "wind_speed_ms": 1.0},
        })
        assert response.status_code == 422

    def test_missing_body_is_rejected(self, client):
        assert client.post("/api/predict/heat", json={}).status_code == 422

    def test_error_responses_never_leak_a_traceback(self, client):
        response = client.post("/api/predict/heat", json={"station_id": 5})
        assert response.status_code == 422
        text = response.text.lower()
        assert "traceback" not in text
        assert "file \"" not in text


class TestSimulation:
    def test_baseline_and_scenarios_are_returned(self, client, station_id, conditions):
        response = client.post("/api/simulate", json={
            "station_id": station_id,
            "baseline": conditions,
            "scenarios": [
                {"name": "More green", "overrides": {"green_fraction_1km": 0.85}},
                {"name": "Windier", "conditions": {**conditions, "wind_speed_ms": 9.0}},
            ],
        })
        assert response.status_code == 200
        body = response.json()
        assert len(body["scenarios"]) == 2
        assert "model-based scenario simulation" in body["method"].lower()

    def test_deltas_are_consistent_with_the_predictions(self, client, station_id, conditions):
        body = client.post("/api/simulate", json={
            "station_id": station_id,
            "baseline": conditions,
            "scenarios": [{"name": "Greener", "overrides": {"green_fraction_1km": 0.85}}],
        }).json()
        baseline = body["baseline"]["prediction"]["uhi_intensity_c"]
        scenario = body["scenarios"][0]
        assert scenario["delta_uhi_c"] == pytest.approx(
            scenario["prediction"]["uhi_intensity_c"] - baseline, abs=0.01
        )

    def test_changed_inputs_are_itemised(self, client, station_id, conditions):
        body = client.post("/api/simulate", json={
            "station_id": station_id,
            "baseline": conditions,
            "scenarios": [{"name": "Greener", "overrides": {"green_fraction_1km": 0.85}}],
        }).json()
        changes = body["scenarios"][0]["changes"]
        assert any(c["field"] == "green_fraction_1km" for c in changes)
        for change in changes:
            assert change["delta"] == pytest.approx(
                change["scenario_value"] - change["baseline_value"], abs=1e-6
            )

    def test_an_unchanged_scenario_produces_no_delta(self, client, station_id, conditions):
        body = client.post("/api/simulate", json={
            "station_id": station_id,
            "baseline": conditions,
            "scenarios": [{"name": "Identical"}],
        }).json()
        assert body["scenarios"][0]["delta_uhi_c"] == pytest.approx(0.0, abs=1e-9)
        assert body["scenarios"][0]["changes"] == []

    def test_too_many_scenarios_are_rejected(self, client, station_id, conditions):
        response = client.post("/api/simulate", json={
            "station_id": station_id,
            "baseline": conditions,
            "scenarios": [{"name": f"S{i}"} for i in range(12)],
        })
        assert response.status_code == 422


class TestHotspots:
    def test_baseline_layer(self, client, requires_models):
        body = client.get("/api/hotspots").json()
        assert body["summary"]["n_sites"] > 50
        assert body["caveats"]
        site = body["sites"][0]
        assert "observed" in site and "modelled" in site

    def test_dynamic_layer_is_sorted_hottest_first(self, client, requires_models, conditions):
        body = client.post("/api/hotspots", json={"conditions": conditions}).json()
        values = [s["uhi_c"] for s in body["sites"]]
        assert values == sorted(values, reverse=True)
        assert body["scale"]["min"] <= body["scale"]["max"]

    def test_dynamic_layer_respects_a_limit(self, client, requires_models, conditions):
        body = client.post("/api/hotspots", json={"conditions": conditions, "limit": 5}).json()
        assert len(body["sites"]) == 5

    def test_hotter_background_raises_every_site_temperature(self, client, requires_models, conditions):
        cool = client.post("/api/hotspots", json={
            "conditions": {**conditions, "t_ref_c": 18.0}, "limit": 20}).json()
        hot = client.post("/api/hotspots", json={
            "conditions": {**conditions, "t_ref_c": 33.0}, "limit": 20}).json()
        cool_by_id = {s["station_id"]: s["temp_c"] for s in cool["sites"]}
        for site in hot["sites"]:
            if site["station_id"] in cool_by_id:
                assert site["temp_c"] > cool_by_id[site["station_id"]]


class TestEnergy:
    @pytest.fixture(autouse=True)
    def _requires_energy(self, has_energy_model):
        if not has_energy_model:
            pytest.skip("energy model not built")

    def test_prediction(self, client):
        zones = client.get("/api/zones").json()["zones"]
        response = client.post("/api/predict/energy", json={
            "zone": zones[0]["zone"],
            "conditions": {"temp_c": 31.0, "relative_humidity_pct": 60.0},
        })
        assert response.status_code == 200
        body = response.json()
        assert body["prediction"]["load_mw"] > 0
        assert body["model"]["unit"] == "MW"

    def test_hot_weather_raises_summer_demand(self, client):
        zones = client.get("/api/zones").json()["zones"]
        zone = max(zones, key=lambda z: z["mean_mw"])["zone"]
        mild = client.post("/api/predict/energy", json={
            "zone": zone, "timestamp": "2024-07-16T21:00:00Z",
            "conditions": {"temp_c": 21.0, "relative_humidity_pct": 60.0,
                           "temp_24h_mean_c": 20.0, "temp_24h_max_c": 23.0},
        }).json()["prediction"]["load_mw"]
        hot = client.post("/api/predict/energy", json={
            "zone": zone, "timestamp": "2024-07-16T21:00:00Z",
            "conditions": {"temp_c": 35.0, "relative_humidity_pct": 60.0,
                           "temp_24h_mean_c": 31.0, "temp_24h_max_c": 36.0},
        }).json()["prediction"]["load_mw"]
        assert hot > mild

    def test_unknown_zone_is_404(self, client):
        response = client.post("/api/predict/energy", json={
            "zone": "ATLANTIS",
            "conditions": {"temp_c": 20.0, "relative_humidity_pct": 50.0},
        })
        assert response.status_code == 404
