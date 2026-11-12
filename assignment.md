# Case: Bulk Digital Banking Onboarding

The bank’s digital banking team receives spreadsheets of members who want to use online banking. Staff need a clear, reliable way to submit each spreadsheet, review the results, and onboard eligible members in a batch.

Build the staff-facing interface using **HTML, CSS, and TypeScript**. The bank will provide the API executable, SQLite database, and OpenAPI specification. Use the API for all application data; the browser must not access the database directly. Do not use React or another UI framework.

## What staff need to do

Staff should be able to:

- Create an upload batch with a required name and optional description.
- Download the XLSX template and upload a completed workbook.
- Resume an upload after a network interruption.
- Follow validation progress reported by the server.
- Review each row’s status and reason before taking action.
- Confirm they have reviewed the results, then commit only valid rows.
- Inspect and download invalid or duplicate rows.
- View a paginated list of all uploaded batches, search and filter the list, and open any batch to see its details and records.
- Find and review records within a batch using search, filters, and pagination, then export records by status.
- View a paginated list of all onboarded members, search the list, and open an individual member’s details.

Validation must not onboard members. Show a member as onboarded only after the API confirms the commit.

## Product expectations

Help staff understand the current state of their work, what needs attention, and what happened after each action. Include clear loading, empty, error, and recovery states.

Use semantic HTML and accessible controls. Keep the browser code organized and easy to explain. Avoid logging or storing member information unless the interface needs it.

## Working with the API

Use the supplied OpenAPI specification and its examples as the source of truth.

- Send and receive XML where the API expects it.
- Parse XML responses and explain HTTP errors clearly.
- Handle file downloads as binary or CSV, as appropriate.
- Use Server-Sent Events (SSE) for validation progress, and recover if the connection drops.
- Use the API’s supported OData-style query options for list search, filtering, sorting, and pagination.
- Make the API address configurable so the interface can use the port set in `config.xml`.

## Walkthrough

Demonstrate the interface using a batch named **“Riverside Branch - October Enrolment”** with a short description. The workbook should contain eligible members, duplicate entries, and members whose details do not match core banking.

Show how staff would:

1. Open the **New Batch** page or modal. Enter a batch name and description, then download the spreadsheet template.
2. Fill in the template with member details and upload the completed file.
3. Simulate a lost network connection during upload. Restore the connection and resume the same batch.
4. Watch the validation progress until the API reports that it is complete.
5. Open the batch and review the results. Check each row’s status and reason. No members have been onboarded yet.
6. Confirm that you have reviewed the results, then commit the valid rows.
7. Check the API’s confirmation to see which members were onboarded. Invalid and duplicate rows should remain in the batch for review or download.
8. Return to the batch list. Find the batch, filter its records by status, and export the records you need.
9. Open the onboarded-members list. Find a member from the batch and view their details.