#!/usr/bin/env python3
"""Validate local research records and export CSV; never enroll or send contacts."""

import argparse
import csv
import io
import json
from pathlib import Path
from urllib.parse import urlparse


HERE = Path(__file__).resolve().parent
SCORE_FIELDS = [
    "payment_friction_score", "crypto_demand_score", "integration_fit_score",
    "reachability_score", "switching_penalty",
]
FIELDS = [
    "id", "account_rank", "niche_rank", "niche_id", "niche", "company", "domain",
    "target_role", "contact_url", "contact_email", "contact_source_url",
    "contact_status", "crypto_status", "evidence", "source_urls",
    "source_checked_at", "pain_hypothesis", "pain_status", "integration",
    "qualification", "disqualifier", "search_query", "score",
    "payment_friction_score", "crypto_demand_score", "integration_fit_score",
    "reachability_score", "switching_penalty", "status", "send_approved",
    "campaign_id", "do_not_contact", "subject", "message",
]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def normalized_domain(domain):
    value = domain.strip().lower().removeprefix("www.").rstrip(".")
    require(value and "." in value and "/" not in value and "@" not in value,
            f"Invalid company domain: {domain!r}")
    return value


def validate_url(value):
    parsed = urlparse(value)
    require(parsed.scheme == "https" and parsed.hostname and not parsed.username
            and not parsed.password, f"Expected public HTTPS URL: {value!r}")


def validate(data, suppression):
    require(data["schema_version"] == 1, "Unsupported research schema")
    require(suppression["schema_version"] == 1, "Unsupported suppression schema")
    targets = data["targets"]
    require(len(targets) == 10, "Expected 10 researched accounts")
    require(len({t["niche_id"] for t in targets}) == 10, "Expected 10 distinct niches")
    require(sorted(t["niche_rank"] for t in targets) == list(range(1, 11)),
            "Niche ranks must cover 1–10")
    require(sorted(t["account_rank"] for t in targets) == list(range(1, 11)),
            "Account ranks must cover 1–10")
    require(len({t["id"] for t in targets}) == len(targets), "Duplicate record IDs")
    domains = [normalized_domain(t["domain"]) for t in targets]
    require(len(set(domains)) == len(domains), "Duplicate company domains")
    blocked = [normalized_domain(row["domain"]) for row in suppression["domains"]]
    for target, domain in zip(targets, domains):
        prefix = f"{target['id']}: "
        require(not any(domain == block or domain.endswith("." + block)
                        for block in blocked), prefix + "suppressed account")
        require(target["status"] == "research_draft", prefix + "must remain a draft")
        require(target["send_approved"] is False, prefix + "must not be send-approved")
        require(target["campaign_id"] is None, prefix + "must not be enrolled")
        require(target["do_not_contact"] is False, prefix + "remove suppressed target")
        require(target["pain_status"] == "hypothesis_requires_discovery",
                prefix + "do not present hypotheses as established pain")
        require(target["source_checked_at"] == data["researched_at"],
                prefix + "research date mismatch")
        require(len(target["sources"]) >= 1, prefix + "missing evidence")
        for url in target["sources"] + [target["contact_url"],
                                        target["contact_source_url"]]:
            validate_url(url)
        if target["contact_email"]:
            parts = target["contact_email"].split("@")
            require(len(parts) == 2 and parts[0], prefix + "invalid role email")
            email_domain = normalized_domain(parts[1])
            require(email_domain == domain or email_domain.endswith("." + domain),
                    prefix + "role email must belong to the company")
        scores = target["scores"]
        require(len(scores) == 5, prefix + "expected five score dimensions")
        require(all(type(s) is int and 0 <= s <= 3 for s in scores[:4])
                and type(scores[4]) is int and 0 <= scores[4] <= 2,
                prefix + "invalid score")
        require(target["score"] == sum(scores[:4]) - scores[4],
                prefix + "score arithmetic mismatch")
        for key in ["company", "niche", "target_role", "qualification",
                    "disqualifier", "pain_hypothesis", "subject", "message"]:
            require(isinstance(target[key], str) and target[key].strip(),
                    prefix + f"missing {key}")
        require("\n" in target["message"], prefix + "draft must preserve paragraphs")


def render_csv(data):
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=FIELDS, lineterminator="\n")
    writer.writeheader()
    for target in sorted(data["targets"], key=lambda row: row["account_rank"]):
        row = {key: target.get(key, "") for key in FIELDS}
        row["source_urls"] = " | ".join(target["sources"])
        for key, score in zip(SCORE_FIELDS, target["scores"]):
            row[key] = score
        row["send_approved"] = "false"
        row["do_not_contact"] = "false"
        row["campaign_id"] = ""
        for key, value in row.items():
            if isinstance(value, str):
                require(not value.lstrip().startswith(("=", "+", "-", "@")),
                        f"{target['id']}: spreadsheet formula prefix in {key}")
        writer.writerow(row)
    return output.getvalue()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true",
                        help="Validate inputs and require the committed CSV to match.")
    args = parser.parse_args()
    try:
        data = json.loads((HERE / "targets.json").read_text(encoding="utf-8"))
        suppression = json.loads((HERE / "suppression.json").read_text(encoding="utf-8"))
        validate(data, suppression)
        expected = render_csv(data)
        path = HERE / "targets.csv"
        if args.check:
            require(path.exists(), "Missing targets.csv; run export.py first")
            require(path.read_bytes() == expected.encode("utf-8"),
                    "CSV differs from targets.json; run export.py")
        else:
            path.write_bytes(expected.encode("utf-8"))
        # Round-trip the multiline message bodies through the actual CSV parser.
        rows = list(csv.DictReader(io.StringIO(expected, newline="")))
        originals = sorted(data["targets"], key=lambda target: target["account_rank"])
        require(len(rows) == len(originals), "CSV row count changed")
        require(all(row["message"] == target["message"]
                    for row, target in zip(rows, originals)),
                "CSV message round-trip failed")
        for row, target in zip(rows, originals):
            require(row["status"] == "research_draft"
                    and row["send_approved"] == "false"
                    and row["campaign_id"] == "", "CSV draft status changed")
            require([int(row[key]) for key in SCORE_FIELDS] == target["scores"],
                    "CSV score dimensions changed")
    except (KeyError, TypeError, ValueError, OSError) as error:
        parser.exit(1, f"Research export failed: {error}\n")
    print(f"Validated {len(rows)} draft accounts across 10 niches; "
          "sources, scores, suppressions and CSV match. No network or sending.")


if __name__ == "__main__":
    main()
