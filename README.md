# Blue Carbon Trust

Build a production-quality MVP web application called:

"BlueCarbon MRV Registry"

Tagline:
"Trusted Monitoring, Reporting & Verification for India's Blue Carbon Ecosystems"

==================================================
PROJECT CONTEXT
==================================================

This application is an MVP for the Ministry of Earth Sciences (MoES) problem statement:

"Blockchain-Based Blue Carbon Registry and MRV System"

The system should help register, monitor, report, verify and maintain trusted records of blue-carbon restoration projects such as:

- Mangroves
- Seagrass
- Salt marshes
- Coastal wetlands

The core problem is that restoration evidence, field data, verification and carbon-impact records can be fragmented across organizations, spreadsheets, reports and field systems.

The application should create a trusted end-to-end workflow:

PROJECT REGISTRATION
→ FIELD DATA COLLECTION
→ EVIDENCE VALIDATION
→ AI-ASSISTED ANOMALY DETECTION
→ HUMAN / NCCR VERIFICATION
→ IMMUTABLE BLOCKCHAIN RECORD
→ VERIFIED CARBON IMPACT RECORD
→ PUBLIC QR VERIFICATION

IMPORTANT PRODUCT PRINCIPLE:

This MVP DOES NOT issue real carbon credits.

The application should use the term:

"Verified Carbon Impact"

measured in:

"tCO₂e"

instead of claiming:

"Carbon Credits Issued"

The system may demonstrate how a future carbon-credit issuance workflow could work, but actual carbon-credit issuance must be outside the scope of this MVP and would require an approved carbon methodology, authorized verification and the relevant regulatory/registry process.

==================================================
CORE PRODUCT POSITIONING
==================================================

The product is NOT:

"Blockchain creates carbon credits."

The product IS:

"A trusted digital MRV and registry system that connects field evidence, validation, human verification, tamper-evident records and verified carbon impact."

Core workflow:

CAPTURE
→ VALIDATE
→ VERIFY
→ RECORD
→ PROVE

Blockchain is used as a trust/audit layer.

AI is used only where useful for screening and anomaly detection.

Human/scientific verification remains responsible for the final decision.

IMPORTANT:

Blockchain does NOT prove that the original field data is true.

It provides a tamper-evident record of information that has already been submitted and verified.

==================================================
1. USER ROLES
==================================================

Create 3 user roles.

--------------------------------
A. PROJECT OWNER
--------------------------------

Examples:

- NGO
- Coastal community
- Restoration organization

Capabilities:

- Register projects
- Upload field evidence
- Submit projects for verification
- View project status
- View validation results
- View verification feedback
- View verified carbon impact
- View blockchain proof
- Generate/view QR verification certificate

--------------------------------
B. NCCR / GOVERNMENT VERIFIER
--------------------------------

Capabilities:

- View submitted projects
- Review project details
- View GPS location
- View project map
- View uploaded evidence
- View validation results
- View AI anomaly flags
- Review carbon-impact information
- Approve project
- Reject project
- Request corrections
- View verification history
- Create blockchain registry record after approval

--------------------------------
C. PUBLIC USER
--------------------------------

No login required.

Capabilities:

- Open a project verification QR
- View public project information
- View project location
- View restoration activity
- View verification status
- View verified carbon impact
- View blockchain proof
- View verification timeline

==================================================
2. AUTHENTICATION
==================================================

Create:

- Login
- Signup
- Role-based access
- Logout
- Protected dashboards

Create demo accounts:

Project Owner:
owner@bluecarbon.demo

Verifier:
verifier@nccr.demo

Public users do not require login.

If real authentication is unavailable, implement functional demo authentication using the application database.

==================================================
3. DESIGN SYSTEM
==================================================

Create a premium government + climate-tech interface.

Visual style:

- Professional
- Scientific
- Trustworthy
- Modern
- Environmental
- Clean
- Minimal
- Data-driven

Avoid a generic "AI SaaS dashboard" appearance.

Use:

- Deep navy
- Ocean blue
- Teal
- White
- Light gray
- Subtle green accents

Use:

- Rounded cards
- Professional tables
- Status badges
- Maps
- Charts
- Clean typography
- Subtle shadows
- Clear information hierarchy

The application should look suitable for:

- Ministry officials
- Government agencies
- Scientists
- NGOs
- Environmental organizations
- Carbon-market stakeholders

Make the application fully responsive.

==================================================
4. LANDING PAGE
==================================================

Create a professional landing page.

Hero heading:

"India's Trusted Blue Carbon MRV Registry"

Subtitle:

"Capture restoration evidence, verify environmental impact, and create a transparent, tamper-evident record of blue-carbon projects."

Primary CTA:

"Register a Project"

Secondary CTA:

"Explore Verified Projects"

Show ecosystem cards:

1. Mangroves
2. Seagrass
3. Coastal Wetlands

Show workflow:

Capture
→ Validate
→ Verify
→ Record
→ Prove

Show demo statistics:

128 Registered Projects

42,680 Hectares Monitored

1.84M tCO₂e Verified Carbon Impact

96 Verified Projects

Clearly label these as:

"Demo Data"

IMPORTANT:

Do NOT display:

"1.84M Carbon Credits Issued"

Instead display:

"1.84M tCO₂e Verified Carbon Impact"

==================================================
5. PROJECT OWNER DASHBOARD
==================================================

Create a dashboard for project owners.

Top statistics:

- Total Projects
- Draft Projects
- Under Verification
- Verified Projects
- Verified Carbon Impact

Project table:

- Project ID
- Project Name
- Ecosystem
- Location
- Area
- Status
- Verified Carbon Impact
- Last Updated
- Actions

Status values:

DRAFT
SUBMITTED
UNDER REVIEW
CORRECTION REQUIRED
VERIFIED
REJECTED

Primary button:

"+ Register New Project"

==================================================
6. PROJECT REGISTRATION
==================================================

Create a multi-step project registration form.

--------------------------------
STEP 1 — BASIC INFORMATION
--------------------------------

Fields:

- Project Name
- Organization Name
- Project Description
- Project Owner
- Contact Email
- Contact Phone

--------------------------------
STEP 2 — ECOSYSTEM
--------------------------------

Dropdown:

- Mangrove
- Seagrass
- Salt Marsh
- Coastal Wetland
- Other

--------------------------------
STEP 3 — LOCATION
--------------------------------

Fields:

- State
- District
- Coastal Area
- Latitude
- Longitude
- Project Area (hectares)

Display an interactive map.

Allow the user to:

- Enter coordinates
- Select location on map

--------------------------------
STEP 4 — RESTORATION INFORMATION
--------------------------------

Fields:

- Restoration Start Date
- Restoration End Date
- Restoration Method
- Species
- Number of Plants/Units
- Survival Rate
- Estimated Carbon Sequestration
- Supporting Notes

IMPORTANT:

Call the carbon value:

"Estimated Carbon Impact"

NOT:

"Carbon Credits"

--------------------------------
STEP 5 — EVIDENCE
--------------------------------

Allow upload of:

- Field photographs
- Documents
- Survey reports
- Drone imagery
- Other evidence

Store files using normal application/cloud storage.

DO NOT store large files directly on blockchain.

--------------------------------
STEP 6 — REVIEW
--------------------------------

Display all information.

Buttons:

"Save Draft"

"Submit for Verification"

==================================================
7. FIELD EVIDENCE SYSTEM
==================================================

Each evidence item should contain:

- Evidence ID
- Project ID
- File
- Upload Date
- GPS coordinates
- Capture date
- Evidence type
- Uploaded by
- Verification status

Create an evidence gallery.

Verifier can:

- Open image
- View metadata
- View location
- Mark evidence valid
- Mark evidence suspicious
- Add comments

==================================================
8. AUTOMATED VALIDATION ENGINE
==================================================

Create an automated validation engine.

Check:

1. Required fields completed
2. Valid latitude/longitude
3. Location consistency
4. Duplicate image/file detection
5. Missing evidence
6. Suspiciously repeated evidence
7. Missing carbon-impact estimate
8. Unrealistic numerical values
9. Date inconsistencies
10. Project-area inconsistencies

Show:

"Evidence Quality Score"

Example:

87 / 100

Checks:

GPS Coordinates        ✓
Required Data           ✓
Evidence Uploaded      ✓
Duplicate Check        ✓
Date Consistency       ✓
Carbon Data             ⚠

==================================================
9. AI-ASSISTED ANOMALY DETECTION
==================================================

Create an AI-assisted screening module.

IMPORTANT:

AI must NOT make the final verification decision.

AI only assists the verifier.

Example:

AI Risk Assessment:

LOW RISK

✓ GPS information available
✓ Evidence count sufficient
✓ No obvious duplicate images
✓ Restoration dates consistent

Or:

HIGH RISK

⚠ Multiple images appear duplicated
⚠ GPS coordinates inconsistent
⚠ Reported plantation count appears unusually high
⚠ Supporting evidence missing

The verifier must manually review the project.

If an external AI API is unavailable, implement the screening using deterministic rules and clearly label it:

"AI-Assisted / Automated Screening"

Do NOT pretend that a real AI API was used if it was not.

==================================================
10. NCCR VERIFIER DASHBOARD
==================================================

Create a separate government/NCCR verification dashboard.

Statistics:

- Total Projects
- Pending Verification
- Approved
- Rejected
- Correction Required
- Total Verified Carbon Impact

Create a map of registered projects.

Project markers should indicate:

- Pending
- Under Review
- Verified
- Rejected

Verification queue:

Columns:

Project ID
Project Name
Organization
Ecosystem
Location
Area
AI Risk
Evidence Score
Estimated Carbon Impact
Submitted Date
Status
Action

Action:

"Review"

==================================================
11. PROJECT VERIFICATION PAGE
==================================================

When the verifier clicks "Review", display:

LEFT:

Project information

CENTER:

Interactive map

RIGHT:

Verification summary

Sections:

1. Project Overview
2. Location
3. Restoration Information
4. Evidence Gallery
5. Validation Results
6. AI Risk Assessment
7. Carbon Impact
8. Verification History
9. Blockchain Record

Buttons:

"Approve Project"

"Request Correction"

"Reject Project"

Require verifier comments for:

- Rejection
- Correction request

==================================================
12. CARBON IMPACT CALCULATION
==================================================

Create a carbon-impact calculation module.

IMPORTANT:

Do NOT call this:

"Carbon Credit Issuance"

Do NOT display:

"Credits Issued"

Instead use:

"Estimated Carbon Impact"

and after verification:

"Verified Carbon Impact"

Unit:

"tCO₂e"

Example:

Estimated Carbon Impact:
12,450 tCO₂e

After verification:

Verified Carbon Impact:
12,450 tCO₂e

Also display this disclaimer:

"Carbon impact shown by this MVP is an estimated/verified project impact value for demonstration. Actual carbon-credit issuance requires an approved methodology, authorized verification and the applicable regulatory/registry process."

Allow the verifier to confirm the carbon-impact value.

IMPORTANT:

Do not invent scientific carbon coefficients without labeling them as demonstration values.

The system should be architected so an approved scientific methodology can be integrated later.

==================================================
13. BLOCKCHAIN REGISTRY
==================================================

Create a blockchain registry layer.

IMPORTANT:

Do NOT store:

- Photos
- Videos
- Large documents
- Raw datasets

directly on blockchain.

Instead:

1. Create canonical verified project record
2. Generate cryptographic hash
3. Store hash as immutable proof
4. Record:

- Project ID
- Project hash
- Verification timestamp
- Verifier ID
- Verified Carbon Impact
- Blockchain status
- Transaction hash

For MVP, if real blockchain credentials are unavailable:

Create a simulated blockchain/testnet record.

Clearly label it:

"Blockchain Testnet / Demo Record"

Example:

Blockchain Status:
VERIFIED

Network:
Testnet

Transaction:
0x8f3a...92bc

Record Hash:
a82d...91ff

Timestamp:
31 July 2026

IMPORTANT:

The UI must clearly distinguish:

"Verified Carbon Impact"

from:

"Carbon Credits"

Do NOT imply that the blockchain record itself represents an issued carbon credit.

==================================================
14. QR VERIFICATION
==================================================

After a project is verified, generate a QR code.

QR points to:

/verify/{project-id}

Public verification page displays:

BLUE CARBON VERIFIED PROJECT

Project ID

Project Name

Ecosystem

Location

Area

Restoration Period

Verified Carbon Impact

Verification Status

Verifier

Verification Date

Blockchain Record

Add:

"Verify Blockchain Record"

==================================================
15. PUBLIC VERIFICATION PAGE
==================================================

Create a professional public verification page.

Header:

"Verified Blue Carbon Project"

Show:

✓ PROJECT VERIFIED

Project ID:
BC-MNG-0001

Ecosystem:
Mangrove

Location:
Andhra Pradesh, India

Area:
125 hectares

Verified Carbon Impact:
18,420 tCO₂e

Verification Date:
31 July 2026

Blockchain:
Testnet Verified

Map

Selected public evidence

Verification timeline:

Project Registered
↓
Evidence Submitted
↓
Automated Validation
↓
NCCR Review
↓
Project Verified
↓
Blockchain Record Created

IMPORTANT:

Do NOT show:

"18,420 Carbon Credits Issued"

Show:

"18,420 tCO₂e Verified Carbon Impact"

==================================================
16. PROJECT STATUS TIMELINE
==================================================

Every project must have a timeline.

Example:

31 Jul 2026
Project Registered

31 Jul 2026
Evidence Submitted

01 Aug 2026
Automated Validation Completed

02 Aug 2026
NCCR Verification

02 Aug 2026
Project Verified

02 Aug 2026
Blockchain Record Created

==================================================
17. AUDIT LOG
==================================================

Create an audit log.

Track:

- User
- Action
- Timestamp
- Project ID
- Previous status
- New status
- Comments

Examples:

Project submitted
Evidence uploaded
Correction requested
Project verified
Blockchain record created

After blockchain registration, clearly indicate that the record has a tamper-evident proof.

==================================================
18. DATABASE
==================================================

Create database models:

Users

Projects

Evidence

ValidationResults

AIAssessments

VerificationReviews

CarbonImpactRecords

BlockchainRecords

AuditLogs

Notifications

Each project must have a unique ID.

Examples:

BC-MNG-0001
BC-SEA-0002
BC-WET-0003

==================================================
19. NOTIFICATIONS
==================================================

Create notifications:

Project submitted

Verification started

Correction requested

Project verified

Project rejected

Blockchain record created

Example:

"Project BC-MNG-0001 has been verified."

==================================================
20. DEMO DATA
==================================================

Populate the application with realistic demo data.

Create at least 10 projects.

Statuses:

3 Verified
2 Under Review
2 Submitted
2 Correction Required
1 Rejected

Ecosystems:

Mangrove
Seagrass
Salt Marsh
Coastal Wetland

Use locations across Indian coastal regions.

Use realistic but clearly DEMONSTRATION values.

Do NOT represent demo values as real government data.

==================================================
21. ANALYTICS
==================================================

Create analytics.

Display:

Projects by ecosystem

Projects by state

Verified vs pending projects

Total monitored area

Total estimated carbon impact

Total verified carbon impact

Projects over time

Use charts and maps.

IMPORTANT:

Use the label:

"Verified Carbon Impact (tCO₂e)"

NOT:

"Carbon Credits Issued"

==================================================
22. MAP
==================================================

Create an India coastal map.

Display project markers.

Clicking a marker shows:

Project name

Ecosystem

State

Status

Area

Verified Carbon Impact

Button:

"View Project"

==================================================
23. NAVIGATION
==================================================

Main navigation:

Home
Projects
Map
How It Works
About

Project Owner:

Dashboard
My Projects
Register Project
Evidence
Notifications
Profile

Verifier:

Dashboard
Verification Queue
Projects
Map
Analytics
Audit Logs

Public:

Verify Project

==================================================
24. RESPONSIVE DESIGN
==================================================

The application must work on:

Desktop
Tablet
Mobile

The field data collection interface must be especially mobile-friendly.

Field workers should be able to:

- Open project
- Capture/upload evidence
- Enter coordinates
- Enter restoration data
- Submit evidence

with minimal steps.

==================================================
25. TECHNICAL REQUIREMENTS
==================================================

Preferred stack:

Frontend:
React
TypeScript
Tailwind CSS

Backend:
Platform-supported backend

Database:
PostgreSQL or equivalent relational database

Maps:
Leaflet/OpenStreetMap or equivalent

Charts:
Suitable chart library

QR:
QR generation library

Blockchain:
Create a blockchain abstraction/service layer.

This should allow future integration with:

- Ethereum-compatible network
- Polygon
- Other approved blockchain infrastructure

Use environment variables for:

AI API keys

Blockchain RPC URL

Blockchain private key

Storage credentials

Never expose secrets in frontend code.

==================================================
26. UX REQUIREMENTS
==================================================

Every important action must provide feedback.

Examples:

"Project saved successfully."

"Evidence uploaded."

"Validation completed."

"Project submitted for verification."

"Correction requested."

"Project verified successfully."

"Blockchain proof created."

Use:

- Loading states
- Empty states
- Error handling
- Confirmation dialogs
- Success notifications

Confirmation required for:

Approve Project
Reject Project
Request Correction

==================================================
27. SECURITY AND DATA TRUST
==================================================

Implement role-based access control.

Project Owners should only access their own private projects.

Verifiers can access projects submitted for verification.

Public users can only access approved public project information.

Private information should never be exposed publicly.

Do not expose:

- Phone numbers
- Private emails
- Internal comments
- Private documents
- Authentication credentials

==================================================
28. COMPLETE DEMO FLOW
==================================================

The following flow MUST work end-to-end.

STEP 1:

Login as:

owner@bluecarbon.demo

STEP 2:

Register a Mangrove restoration project.

STEP 3:

Enter:

- Location
- Area
- Ecosystem
- Restoration information

STEP 4:

Upload field evidence.

STEP 5:

Submit project.

STEP 6:

Automated validation runs.

STEP 7:

AI-assisted anomaly screening runs.

STEP 8:

Login as:

verifier@nccr.demo

STEP 9:

Open Verification Queue.

STEP 10:

Open submitted project.

STEP 11:

Verifier reviews:

- Project information
- Map
- Evidence
- Validation results
- AI risk assessment
- Estimated Carbon Impact

STEP 12:

Verifier approves the project.

STEP 13:

System changes:

SUBMITTED

→ UNDER REVIEW

→ VERIFIED

STEP 14:

System creates:

Verified Carbon Impact Record

Example:

Verified Carbon Impact:
12,450 tCO₂e

STEP 15:

System generates blockchain testnet/demo proof.

STEP 16:

System generates QR verification page.

STEP 17:

Open public verification page.

STEP 18:

Show:

✓ Project Verified
✓ Evidence
✓ Verification History
✓ Verified Carbon Impact
✓ Blockchain Proof

==================================================
29. IMPORTANT SCOPE LIMITATIONS
==================================================

DO NOT build these in the MVP:

❌ Real carbon-credit marketplace

❌ Real carbon-credit trading

❌ Real financial transactions

❌ Automatic carbon-credit issuance

❌ Full satellite-processing infrastructure

❌ Full drone-processing infrastructure

❌ IoT hardware

❌ AI-based final verification

❌ Automated scientific certification

These can be future extensions.

==================================================
30. FUTURE ROADMAP
==================================================

Create an "Future Expansion" section showing:

Phase 2:

- Satellite data integration
- Drone imagery integration
- Advanced AI image analysis
- Offline field collection
- Sensor/IoT integration
- Advanced MRV methodologies

Phase 3:

- Integration with approved carbon standards
- Authorized carbon-credit issuance workflow
- Carbon-credit retirement
- Carbon-market integrations
- Interoperability with external registries

Make it clear these are future capabilities and NOT part of the MVP.

==================================================
31. FINAL MVP PRIORITY
==================================================

Prioritize functionality in this order:

1. Authentication
2. Project registration
3. Evidence upload
4. Automated validation
5. Verifier dashboard
6. Verification workflow
7. Verified Carbon Impact calculation/record
8. Blockchain proof/demo
9. QR verification
10. Public verification
11. AI-assisted anomaly detection
12. Analytics

If any feature cannot be fully implemented, create a realistic functional demonstration rather than leaving broken buttons.

==================================================
32. FINAL PRODUCT MESSAGE
==================================================

The application should communicate this clearly:

"BlueCarbon MRV Registry creates a trusted digital trail from restoration activity to verified environmental impact."

The core value proposition:

"Capture → Validate → Verify → Record → Prove"

And the system must clearly distinguish:

ESTIMATED CARBON IMPACT
↓
VERIFIED CARBON IMPACT
↓
[FUTURE]
CARBON CREDIT ISSUANCE

The MVP stops at:

"VERIFIED CARBON IMPACT"

It does NOT claim:

"CARBON CREDITS ISSUED"

==================================================
33. FINAL REQUIREMENT
==================================================

Build the actual working application, not a static UI mockup.

All major buttons must work.

All forms must save data.

Project status must change through the workflow.

Evidence must be associated with projects.

Validation must run.

AI-assisted screening must run.

Verifier decisions must update project status.

Approved projects must generate a verified carbon-impact record.

Approved projects must generate a blockchain proof/demo record.

Approved projects must generate a QR verification page.

The public verification page must work.

The complete demo workflow must work without manually editing the database.

Make the application presentation-ready for a Smart India Hackathon demonstration.

At the end, provide:

1. Application URL
2. Demo login credentials
3. Database schema
4. Architecture overview
5. Implemented features
6. Simulated components
7. Blockchain integration instructions
8. AI integration instructions
9. Future carbon-credit issuance integration plan

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://bluecarbon-registry.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/d81ed2e0-67cd-4fea-951b-0a6dd77c0957).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js (v20+) and npm.

```sh
git clone <this-repository-url>
cd bluecarbon-registry
npm install
npm test          # Runs automated test suite (25 tests)
npm run typecheck # TypeScript compiler checks
npm run dev       # Starts Vite local development server
```

---

## Production Readiness & Security Hardening Audit Resolutions

In response to the comprehensive Production Readiness Audit (October 2026), the codebase was audited and hardened with the following verified architectural and security fixes:

### 1. Security Containment & Privilege Escalation (P0 Resolved)
- **Eliminated Signup Privilege Escalation**: Patched `public.handle_new_user()` trigger in `supabase/migrations/20261021000000_fix_privilege_escalation_and_harden_rls.sql`. Any `role` key passed in `raw_user_meta_data` is strictly ignored; all new registrations unconditionally receive the least-privilege `project_owner` role.
- **Removed Unauthenticated Demo Account Provisioning**: Deleted the unauthenticated `provisionDemoAccounts` server function. Account provisioning is restricted to the protected administrative script `scripts/seed-demo-accounts.ts`, which requires explicit environment confirmation (`ALLOW_DEMO_SEED=true`).
- **Sanitized Secrets & Git Hygiene**: Removed `.env` from version control tracking, added environment secret patterns to `.gitignore`, and provided a comprehensive `.env.example` template.

### 2. Verification Workflow & Data Integrity (P0 Resolved)
- **Strict State Machine**: Enforced strict valid status transitions (`DRAFT` → `SUBMITTED` → `UNDER_REVIEW` → `VERIFIED` / `CORRECTION_REQUIRED` / `REJECTED`). Disallowed approving directly from `DRAFT`, `REJECTED`, or `CORRECTION_REQUIRED`.
- **Atomic Database Transactions**: Created `public.perform_verification_decision` stored procedure executing status update, review log, carbon impact, durable audit log, timeline event, and notifications within a single atomic PostgreSQL transaction.
- **Optimistic Concurrency Control**: Status transitions enforce optimistic locking on expected status to eliminate concurrent verification race conditions.
- **Strict Input Boundaries**: Confirmed carbon values must be positive, finite numbers (`confirmedCarbon > 0`). Mandatory comments (≥ 5 characters) are strictly enforced for correction and rejection decisions.
- **Durable Audit Logs**: Audit log failures now throw exceptions rather than failing silently, preventing unrecorded mutations.

### 3. Real Blockchain Anchoring & Transparency (P0 Resolved)
- **Solidity Smart Contract**: Provided `contracts/BlueCarbonRegistry.sol` for deploying on-chain anchor registries with tamper-evident record hashing and verification events.
- **Real EVM JSON-RPC Client**: Implemented standard EVM JSON-RPC client in `src/lib/blockchain.server.ts` supporting transaction submission, receipt polling, and block confirmations tracking.
- **Independent On-Chain Verification**: Added `verifyOnChainAnchor()` and frontend `VerifyChainButton` allowing verifiers and the public to verify receipts directly against RPC nodes.
- **Explicit Transparency**: The UI and API strictly distinguish simulated records (`simulated: true`, "Simulated Demo Record") from genuine on-chain confirmations ("Live On-Chain Anchor"), never misrepresenting testnet simulations.

### 4. Scientific Blue Carbon Accounting Methodology (P0 Resolved)
- **IPCC 2013 & Verra VM0033 Standard**: Integrated `src/lib/carbon-methodology.ts` replacing demo coefficients with peer-reviewed scientific parameters (IPCC Coastal Wetlands Supplement Chapter 4 & Verra VM0033).
- **Carbon Pool Breakdown**: Distinct calculations for Aboveground/Belowground Biomass ($C_{bio}$) and Soil Organic Carbon Accretion ($C_{soc}$).
- **Mandatory Risk Buffers & Deductions**:
  - 15% non-permanence risk buffer withholding for reversal risks.
  - Salinity-dependent methane GHG emissions deduction (for brackish waters < 18 ppt).
  - Activity displacement leakage deduction.
  - Scientific uncertainty discount factor (10% Tier 1 default, 3% Tier 2 site samples).
- **Clear Separation**: Distinguishes Estimated Gross Sequestration from Net Verified Carbon Impact.

### 5. Evidence Privacy & Upload Validation
- **Secure URL Signing**: `signEvidenceUrls` and `signCommunityUrls` reject arbitrary or external URLs, enforce `storage://` path validation, and verify caller project ownership or verifier authorization.
- **Upload Validation Engine**: `src/lib/evidence-validator.ts` enforces 25MB file limits, whitelisted MIME types, extension validation, and sanitizes filenames against directory traversal (`../`, `..\`).
- **Public Privacy Safeguards**: Public lookup endpoints strictly exclude non-public evidence items and redact sensitive personal contact details.

### 6. Automated Testing & CI/CD Pipeline
- **Comprehensive Test Suite**: Added 25 automated tests across 5 test suites (`tests/**/*.test.ts`) covering security authorization, state transitions, scientific carbon math, evidence upload validation, and blockchain anchoring.
- **GitHub Actions CI**: Added `.github/workflows/ci.yml` running tests across Node 20, 22, and 24, verifying code formatting, TypeScript type checks, and production builds on every PR.

