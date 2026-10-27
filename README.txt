BULK DIGITAL BANKING ONBOARDING

WELCOME
Build a staff-facing bulk digital banking onboarding interface using HTML, CSS, and TypeScript. The API and SQLite database are supplied; designing and building the interface is your work. Do not use React or another UI framework.

WHAT IS IN THIS KIT
- windows-x64/ and linux-x64/: API binaries and launch scripts.
- data/onboarding.sqlite: clean training database seeded with 10 synthetic core banking members.
- data/seed-core-members.sql: optional example SQL inserts for adding more synthetic core members.
- config.xml: API port setting (3000 by default).
- spec-openapi.yaml: API contract, including XML request and response examples.
- assignment.md: the case and expected demonstration.

There are no filled XLSX workbooks in this kit. Build your own demonstration workbook from the records in data/onboarding.sqlite. Start the API and download the blank workbook template from its template endpoint. Use the template's columns and choose a mix of identifiers that match the simulated core banking records and deliberately changed or duplicate details for your review scenarios. The API specification describes the required fields and supported values.

START THE API
Windows x64: open windows-x64 and run run.bat from File Explorer or Command Prompt.
Linux x64: from this folder run ./linux-x64/run.sh. If needed, run chmod +x linux-x64/run.sh first.
The API starts on the port in config.xml. Stop it with Ctrl+C in the terminal.

The service creates its operational SQLite tables on first startup. To return to the original 10 core members, stop the API and replace data/onboarding.sqlite with a fresh copy of the kit database.

CONFIGURE THE PORT
Edit the value in config.xml under <api><port> and restart the API. For example, set it to 3100 to listen on port 3100. The PORT environment variable overrides the XML setting when present. Configure your UI's API base address to match the selected port. The local API base is http://localhost:3000/api/v1 with the default setting.

BUILDING AND SEEDING YOUR WORKBOOK
The SQLite database is the source of truth for simulated core members. Inspect data/onboarding.sqlite with a SQLite viewer, or query the core_members table. For example:

  sqlite3 data/onboarding.sqlite "SELECT member_number, phone_number, id_number, first_name, last_name, date_of_birth, email, branch, account_type FROM core_members ORDER BY member_number;"

Use those records to populate the blank workbook downloaded from GET /api/v1/onboarding/template. Keep at least one identifier (member_number, phone_number, or id_number) matched to core_members for rows you want the simulated lookup to accept. To create invalid scenarios, use missing required values, unsupported account types, unknown identifiers, or repeated members; consult the API contract for the validation rules.

To add more lookup fixtures, stop the API before editing its database. You can run the optional SQL seed file with the SQLite command-line tool:

  sqlite3 data/onboarding.sqlite < data/seed-core-members.sql

The inserts use INSERT OR IGNORE and distinct identifiers, so they can be applied again safely. You may also add your own synthetic rows to core_members, ensuring member_number, phone_number, id_number, and account_number are unique. Restart the API after seeding. Never use real member data.

IMPLEMENTATION EXPECTATIONS
The browser must use the API as its application boundary and must never read or write SQLite directly. API metadata is XML, file transfers use binary or CSV, and validation progress uses Server-Sent Events. Build the interface with semantic HTML, accessible controls, and compiled TypeScript. Make the API address configurable. See intern-assignment.md for the complete case.

This is a local training simulator, not a production banking service. Windows and Linux binaries are x64 builds; the Linux binary targets glibc-based distributions.
