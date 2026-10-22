# Calculated fields, health rating and inspections

How the supplied reference documents are implemented. The source files themselves are not stored in this repository.

| Source document | Implemented as |
|---|---|
| Mold Calculated Fields | `src/lib/calc.pure.ts` (unit-tested in `calc.test.ts`); passport **Calculated fields** tab and overview strip; life forecast; API `calculated` block; **Calculated fields** report |
| Mold Health Rating | `RATINGS` in `src/lib/inspection.pure.ts`; rating buttons in the assessment; outcomes on approval |
| Injection Inspection Template | **Injection** inspection template (25 components) + standard questions; **Inspection summary** report (Summary sheet columns) |
| IBM (Injection Blow) Inspection Template | **Injection Blow** inspection template (20 components) |
| Workflow-based Inspection | Guided assessment at **Quality → Start assessment** (`/quality/assess`); **Extrusion Blow** template (13 elements with YES/NO key points) |

## Calculated fields

All values are recalculated whenever the passport, its counter or its site changes. When an input is missing the field says **“Needs …”** with the document's own field names, so users know exactly what to fill in.

| Field | Formula |
|---|---|
| Expected End of Life | Cycle Count Date + ((Refurbs Allowed + 1) × Shots Between Refurb − Cycle Count) ÷ (Annual Volume ÷ # Cavities) × 365.24 days. Without a cycle count: Capitalized Date + (Refurbs Allowed + 1) × Shots Between Refurb ÷ (Annual Volume ÷ # Cavities) × 365.24 |
| Next Refurbishment | Cycle Count Date + Shots Until Refurb ÷ (Annual Volume ÷ # Cavities) × 365.24. Without a cycle count: Capitalized Date + (Refurbs Completed + 1) × Shots Between Refurb ÷ (Annual Volume ÷ # Cavities) × 365.24 |
| Shots Since Last Refurb | Cycle Count − Shots at Refurb Total |
| Shots Until Refurb | (Refurbs Completed + 1) × Shots Between Refurb − Cycle Count |
| Refurbs Remaining | Refurbs Allowed − Refurbs Completed |
| Calculated Replacement Cost | Cost per Cavity (by process) × # Cavities |
| Cost Average Refurb | Estimated Cost New Tool ÷ 3 (0 for Two Part Epoxy) |
| Refurbishment Priority | Next Refurbishment in the past → Critical; within a year → Consider; otherwise Not necessary |
| Remaining Life | 1 − Cycle Count ÷ ((Refurbs Allowed + 1) × Shots Between Refurb) |
| Daily Output Capacity | 3600 ÷ Cycle Time × Hours per Shift × Shifts per Day × # Cavities × OEE |
| Weekly / Annual Output Capacity | Daily × Days per Week; Weekly × Weeks per Year |
| Free Annual Capacity (pcs / %) | Annual Output Capacity − Annual Volume; ÷ Annual Output Capacity |
| Calculated Annual Volume | 0.85 × (365.24 × 24 × 3600) × Utilization × # Cavities ÷ Cycle Time |
| Calculated % Utilization | Annual Volume ÷ Annual Output Capacity |
| Production Days Required | Annual Volume ÷ Daily Output Capacity |
| Actual Cavitation % | Active Cavities ÷ # Cavities |

**Where the inputs live**

- **Mold passport:** Process (department), # Cavities, Cycle Time, Refurbs Allowed/Completed, Shots Between Refurb, Annual Volume, Utilization (%), Capitalized Date, Estimated Cost of a New Tool.
- **Shot counter:** Cycle Count and Cycle Count Date (the latest reading).
- **Cavity list:** Active Cavities.
- **Site** (Admin → Sites): Hours per Shift, Shifts per Day, Days per Week, Weeks per Year, OEE. As the document says, these are location data and capacity cannot be calculated without them.
- **Settings:** cost per cavity per process.

Custom formula fields can use every calculated value by its snake_case name (e.g. `remaining_life_pct`, `shots_until_refurb`, `daily_output_capacity`). Date values are given as days from today.

**Decisions to review**

- **Cost-per-cavity currency.** The document's costs are in US dollars. They are kept as defaults with their own currency (USD), set in Settings, and are not converted. Enter your own figures in INR and set the currency to INR to use rupees.
- **Missing estimated cost.** When “Estimated Cost New Tool” is blank, Cost Average Refurb uses the Calculated Replacement Cost and says so.
- **No refurbishments left.** When none remain, Next Refurbishment shows “the next event is end of life” rather than a date.
- **Thermoforming** is “TBD” in the document, so it needs a cost before replacement cost can be calculated.
- **Two definitions of life.** The passport keeps its End-of-life shots (used for the 80%/95% alerts). The calculated fields use (Refurbs Allowed + 1) × Shots Between Refurb, as the document defines. The life forecast shows the calculated dates and, underneath, the date implied by the last 90 days of readings (“at current pace”).

## Health rating

The scale is **5 Excellent, 4 Good, 3 Fair, 2 Poor, 1 Unacceptable, N/A**, with the descriptions from the Mold Health Rating document.

> **Note:** the legend inside the two inspection spreadsheets numbers the scale the other way round (1 = Excellent … 5 = Unacceptable). The app follows the Mold Health Rating document and always shows the word next to the number.

- **Unacceptable** (“should not run until corrected”):
  - On submission: approvers and maintenance are alerted immediately.
  - On approval: the mold is quarantined and a release work order is raised. Only completing that work order returns the mold to service.
- **Poor:** approval raises a corrective work order. So do reported quality, operational or supply-risk issues, and a weighted score below the asset type's threshold.
- **Comments:** any Poor or Unacceptable component needs a comment explaining it and how to correct it (from the templates' comment guidance).

## Inspection templates and the guided assessment

**Templates** (Quality → Templates) list components, optionally with weights and YES/NO key points. A mold uses the template whose processes include its own process; otherwise it uses the default (Injection). Each organisation gets its own editable copies of the three standard templates.

| Template | Processes |
|---|---|
| Injection | Injection, Precision Injection |
| Injection Blow | Injection Blow, Injection Stretch Blow |
| Extrusion Blow (workflow document; marked there as an initial proposal for peer review) | Extrusion Blow, Stretch Blow |

**Guided assessment** (Quality → Start assessment), following the Workflow-based Inspection:

1. **Start.** Choose **bench** or **machine**. Bench assessments can record **video in the background**; it stops automatically at the final step and is stored with the assessment. Video is disabled for machine assessments.
2. **Select the asset** by ID or number. Its process selects the template.
3. **Capture live data.** Cavities running out of the total, last run date, total shots, annual volume, and whether there are quality issues.
   - A higher total-shots figure is recorded as a shot reading straight away.
   - Annual volume and last run date update the passport when the assessment is approved.
4. **One screen per mold element.** Each shows the previous condition, the key points (YES/NO), a rating with its description, a comment and photos. **A NO answer requires a comment and a photo** before moving on.
5. **Questions from the templates.** Operational issues, spare parts (Okay / Need / TBD), supply risk, overall condition and recommendations. “Need” spare parts notify the inventory team on approval.
6. **Review and submit.** The server re-checks everything.

The **Inspection summary** report reproduces the templates' Summary sheet, one row per mold. Its columns:

- ID, Division, Location, Department, Status, Supplier Tool #, Number, Description, Component Type
- Next Evaluation Date, # Cavities, Cycle Time, Condition Rating, Annual Volume, Cycle Count, Last Run Date
- Last Refurbished, Next Refurbishment, Refurbs Completed, Refurbs Remaining, No. Open Work Orders, New W/O Req Yes or No
- Date Built, Built By, Part Number, Product Drawing #, Brand Name, Platform, Ownership
