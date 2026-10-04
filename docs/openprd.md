# CoinPay OpenPRD collection

Numbered proposals live under `prd/`. The YAML front matter is the source of truth for each proposal's ID and lifecycle status. Existing standalone PRD documents remain historical context.

The collection uses OpenPRD 0.3 and its ten ordered sections. Specification: https://logicsrc.com/docs/openprd

With the LogicSRC CLI installed, run these commands from the repository root:

```sh
logicsrc prd next
logicsrc prd validate --strict --expect-version 0.3
logicsrc prd index --write
```

Use `prd/0000-template.md` when creating a proposal. Recheck numbering immediately before import, particularly when work is concurrent. Regenerate the index after adding or updating a proposal. Use the generator's default index title so the CLI's stale-index check agrees with generated output.

Keep proposals at Draft while requirements are being developed. Move through Review and Accepted when those decisions have actually occurred; Final means implementation has shipped. Proposed release steps, prices, and acceptance tests are not evidence of completed work.
