# Reference Scope

Status: **BLOCKED — reference product identified (COAST Systems), but no
application URL, account access or authorization has been supplied.** No reverse engineering of a Coast product has taken place.

## 1. Materials supplied or authorized so far

| # | Material | Supplied? | Notes |
| --- | --- | --- | --- |
| 1 | Reference application URL(s) | No | — |
| 2 | Login credentials / demo tenant | No | — |
| 3 | Written authorization to analyse the reference | No | Required: analysing a third party's SaaS can be restricted by its terms of service |
| 4 | Installable client / mobile app | No | — |
| 5 | Product documentation, manuals, training material | No | — |
| 6 | HAR captures or screen recordings | No | — |
| 7 | "Existing Coast Systems codebase" | Not found | Accessible repos are `Ezemes/*`; `Ezemes/Mold-Management` is empty; none mention Coast |

## 2. Reference product identity

**Decision (user, 2026-10-22): the reference is COAST Systems' global mold
management platform.** coastapp.com is out of scope.

Search results considered:

A web search found two unrelated companies with this name:

| Candidate | Product | Fit with the brief |
| --- | --- | --- |
| **COAST Systems** (moldmakingtechnology.com coverage) | Cloud global mold management for OEMs with distributed supplier networks: mold location, condition, maintenance history, spare parts, lifecycle planning, optional IIoT | Strong fit for "Global Mold Asset Management" |
| **Coast** (coastapp.com) | Mobile-first CMMS/EAM: assets, work orders, preventive maintenance | Fits the generic "EAM" half only |

The brief also uses "Coast Systems" for the *product being built*
("Proposed Coast Systems implementation"). Whether the user **is** Coast
Systems (reconstructing its own product) or is building a competing product
changes which materials are legitimately available and what may be reused.

## 3. Public-source pass (claims only, not behavior)

Marketing pages and press coverage can supply **claimed** feature names. They
are recorded as `unverified` and never as observed behavior. This pass also
needs those domains allowed by the network policy.

## 4. Scope boundaries (proposed, pending approval)

- In scope: screens, workflows and network behavior visible to the authorized
  test account(s), shipped client bundles, and supplied documents.
- Out of scope: bypassing authentication, accessing other tenants' data, load
  or security testing of the vendor's production systems, and copying
  proprietary code, text, branding or assets into the new product. The new
  product reproduces **functional behavior** with original design and code.
