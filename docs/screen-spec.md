# Screen Specification

## Waste Generator Screens

### 1. Login / Signup

Purpose: Allow a generator to create an account or sign in with a phone number.

Fields:
- Phone number
- OTP or password
- User type, defaulting to generator during signup

Actions:
- Sign in
- Create account
- Verify phone

### 2. Generator Profile

Purpose: Capture one-time generator details used to prefill pickup requests.

Fields:
- Name or organization name
- Generator type: tailor, temple, household, boutique, NGO
- Contact number
- Address
- Location latitude and longitude
- Preferred pickup time window
- Average waste frequency, optional

Actions:
- Use current location
- Save profile
- Edit profile

### 3. Home / Create Pickup Request

Purpose: Give the generator a simple starting point for a new pickup request and show active requests.

Content:
- Primary create pickup request action
- Active request cards
- Latest request status
- Recent completed requests

Actions:
- Create pickup request
- Track active request
- Open profile

### 4. Waste Logging Form

Purpose: Capture details about the currently available textile waste.

Fields:
- Waste category: cloth scraps, sarees, kurtas, bedsheets, temple cloth, mixed fabric, others
- Estimated quantity type: weight or bag count
- Estimated weight in kg, when quantity type is weight
- Estimated bag count, when quantity type is bag count
- Condition: clean, mixed, wet/soiled
- Pickup urgency: normal, urgent
- Pickup address, prefilled from profile and editable
- Location latitude and longitude
- Notes, optional

Actions:
- Continue to photos
- Save draft
- Cancel

### 5. Upload Photos

Purpose: Attach visual evidence to help collectors and warehouse teams prepare.

Fields:
- One to three request photos

Rules:
- At least one photo is recommended for non-household generators.
- Accepted file types should include JPEG, PNG, and WebP.

Actions:
- Add photo
- Remove photo
- Submit request

### 6. Pickup Confirmation

Purpose: Confirm that the pickup request was created.

Content:
- Request ID
- Waste category
- Estimated quantity
- Pickup address
- Current status
- Expected next step

Actions:
- Track request
- Create another request
- Return home

### 7. Track Request Status

Purpose: Show the generator where the request is in the operational flow.

Content:
- Status timeline
- Assigned collector name and phone number, once assigned
- Scheduled pickup time
- Pickup completion timestamp
- Warehouse delivery timestamp

Actions:
- Call collector, once assigned
- Cancel request, only before pickup completion
- View request details

## Waste Collector Screens

### 1. Login

Purpose: Let field staff access their assigned pickups.

Fields:
- Phone number or employee ID
- OTP or password

Actions:
- Sign in

### 2. Collector Profile

Purpose: Capture operational details for assignment and reporting.

Fields:
- Name
- Employee ID
- Phone number
- Assigned zone
- Vehicle type: bike or van

Actions:
- Save profile
- Edit profile

### 3. Assigned Pickups List

Purpose: Show the collector their current work queue.

Content:
- Pickup cards grouped by scheduled date or urgency
- Generator name
- Address summary
- Waste category
- Estimated quantity
- Pickup time window
- Status

Actions:
- Open pickup details
- Start navigation
- Filter by pending, scheduled, completed

### 4. Pickup Details

Purpose: Provide the information needed before arriving at the generator location.

Content:
- Generator name
- Contact number
- Full address
- Map location
- Waste category
- Estimated quantity
- Uploaded photos
- Pickup time window
- Generator notes

Actions:
- Call generator
- Navigate
- Start pickup completion

### 5. Navigate to Location

Purpose: Open map navigation to the pickup location.

Data needed:
- Pickup latitude and longitude
- Full address fallback

Actions:
- Open external maps app
- Return to pickup details

### 6. Pickup Completion Form

Purpose: Record what was actually collected.

Fields:
- Actual quantity type: weight or bag count
- Actual weight in kg, when quantity type is weight
- Actual bag count, when quantity type is bag count
- Condition: clean, mixed, soiled
- Additional photos, optional
- Collector notes, optional
- Generator signature, optional
- Pickup completion timestamp, generated automatically

Actions:
- Mark pickup completed
- Save issue note

### 7. Delivery to Warehouse Form

Purpose: Confirm delivery and warehouse verification.

Fields:
- Warehouse location, auto-captured
- Items delivered
- Actual weight verified
- Warehouse staff name
- Delivery timestamp, generated automatically
- Photo of weighing scale, optional

Actions:
- Mark delivered to warehouse
- Attach weighing photo

### 8. History

Purpose: Let collectors review completed pickups and deliveries.

Content:
- Completed pickups
- Delivered assignments
- Date filters
- Quantity totals

Actions:
- View historical pickup details

## Admin Dashboard Screens

### 1. Dashboard Overview

Content:
- Total open requests
- Requests awaiting collector assignment
- Pickups scheduled today
- Pickups completed today
- Deliveries pending warehouse confirmation

### 2. Requests Table

Content:
- Request ID
- Generator
- Waste category
- Estimated quantity
- Status
- Urgency
- Created date

Actions:
- Assign collector
- Schedule pickup
- Update status
- Open request detail

### 3. Assignment Detail

Content:
- Request details
- Collector details
- Pickup log
- Warehouse delivery log
- Photos
- Status timeline

Actions:
- Reassign collector
- Edit schedule
- Resolve issue

