---
name: Automatic archive expectation
description: Product expectation for when completed registrations leave Inscrições.
---

A registration moves automatically from Inscrições to Arquivo as soon as every scheduled event occurrence has ended. There is no 30-day waiting period and no daily cron, manual eligibility preview, or on/off toggle.

When the admin panel is open, schedule an automatic refresh for the latest end time of each registration's event occurrences. When the panel is opened again after an event ends, immediately catch up and archive all completed eligible registrations. A later event occurrence keeps the registration in Inscrições until it ends.

**Why:** the user explicitly requested immediate automatic archiving once the entire event is complete, with no arbitrary delay or manual controls.

**How to apply:** Preserve unique calendar matching, cancellation checks, and the all-occurrences-complete rule. Keep original registrations and files intact; only change which tab displays the registration.
