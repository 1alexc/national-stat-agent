"""Unit tests for PII redaction and UK phone number detection in guardrails.py."""

from unittest.mock import MagicMock
from backend.social_poster import guardrails


def test_redact_uk_phone_numbers_unformatted_mobile():
    text = "Need help? Email [EMAIL_ADDRESS] or text on 07777111222. #UKStats"
    cleaned = guardrails.redact_uk_phone_numbers(text)

    assert "07777111222" not in cleaned
    assert cleaned == "Need help? Email [EMAIL_ADDRESS] or text on [PHONE_NUMBER]. #UKStats"


def test_redact_uk_phone_numbers_various_mobile_and_landline_formats():
    cases = [
        ("07777111222", "[PHONE_NUMBER]"),
        ("07777 111 222", "[PHONE_NUMBER]"),
        ("07777 111222", "[PHONE_NUMBER]"),
        ("07777-111-222", "[PHONE_NUMBER]"),
        ("+44 7777 111222", "[PHONE_NUMBER]"),
        ("+447777111222", "[PHONE_NUMBER]"),
        ("+44 (0)7777 111222", "[PHONE_NUMBER]"),
        ("020 7946 0192", "[PHONE_NUMBER]"),
        ("(020) 7946 0192", "[PHONE_NUMBER]"),
        ("(07777) 111222", "[PHONE_NUMBER]"),
        ("0113 496 0000", "[PHONE_NUMBER]"),
        ("0800 111 2222", "[PHONE_NUMBER]"),
    ]
    for raw, expected in cases:
        assert guardrails.redact_uk_phone_numbers(raw) == expected


def test_redact_uk_phone_numbers_preserves_statistics_and_dates():
    text = (
        "UK youth unemployment is nearly 5x higher than the prime-age average. "
        "ONS data for Feb–Apr 2025 shows: • 16-24: 14.29% • 25-34: 4.12% • 35-49: 2.87% "
        "• 50-64: 3.01% • 65+: 3.08% Need help? Call 07777111222 #UKStats"
    )
    cleaned = guardrails.redact_uk_phone_numbers(text)

    assert "2025" in cleaned
    assert "14.29%" in cleaned
    assert "4.12%" in cleaned
    assert "2.87%" in cleaned
    assert "3.01%" in cleaned
    assert "3.08%" in cleaned
    assert "16-24" in cleaned
    assert "25-34" in cleaned
    assert "35-49" in cleaned
    assert "50-64" in cleaned
    assert "65+" in cleaned
    assert "07777111222" not in cleaned
    assert "Call [PHONE_NUMBER]" in cleaned


def test_redact_pii_text_tool_replaces_uk_mobile_and_dlp_pii(monkeypatch):
    # Mock DLP de-identify to simulate detecting PERSON_NAME and EMAIL_ADDRESS
    def fake_deidentify(text, info_types, min_likelihood):
        out = text
        if "PERSON_NAME" in info_types:
            out = out.replace("Jane Smith", "[PERSON_NAME]")
        if "EMAIL_ADDRESS" in info_types:
            out = out.replace("jane@example.com", "[EMAIL_ADDRESS]")
        return out

    monkeypatch.setattr(guardrails, "_deidentify", fake_deidentify)

    raw_text = (
        "my name is Jane Smith, email me at jane@example.com or text on 07777111222."
    )
    result = guardrails.redact_pii_text(raw_text)

    assert result["status"] == "success"
    assert result["redacted_text"] == (
        "my name is [PERSON_NAME], email me at [EMAIL_ADDRESS] or text on [PHONE_NUMBER]."
    )

