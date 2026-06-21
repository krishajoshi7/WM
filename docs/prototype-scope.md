# Sustainable ECG Prototype Scope

## User Groups

### Waste Generators

Tailors, temples, households, NGOs, and boutiques who want to report available textile waste and request pickup.

### Waste Collectors

Field staff who receive pickup assignments, collect textile waste, and deliver it to the warehouse.

### Admins

Internal users who assign collectors, monitor request status, and verify warehouse delivery.

## Phase 1 Goals

- Let generators create pickup requests with photos, quantity estimates, location, and urgency.
- Let collectors view assigned pickups, navigate to pickup locations, complete pickup logs, and confirm warehouse delivery.
- Let admins see all requests, assign collectors, update schedules, and track operational status.
- Capture enough structured data for reporting, route planning, and warehouse reconciliation.

## Phase 1 Features

- Login/signup for generators and collectors.
- Generator profile setup.
- Collector profile setup.
- Waste pickup request creation.
- Photo upload for generator request evidence.
- Location capture with editable address.
- Status tracking from request creation through warehouse delivery.
- Assigned pickup list for collectors.
- Pickup completion form with actual quantity and condition.
- Warehouse delivery form with verified weight and staff name.
- Basic admin dashboard for assignment and monitoring.

## Request Statuses

1. `request_created`
2. `collector_assigned`
3. `pickup_scheduled`
4. `pickup_completed`
5. `delivered_to_warehouse`
6. `cancelled`

## Prototype Success Criteria

- A generator can submit a pickup request in under two minutes.
- A collector can see assigned work and mark pickup completion from mobile.
- Warehouse delivery can be reconciled against the original request.
- Admin can identify pending, active, completed, and delayed pickups.
- Photos and location data are associated with the correct request.

