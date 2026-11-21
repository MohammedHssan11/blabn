# Phase 4 decisions from Abdo

Recorded on 21 November 2026 for the Maarif branch. Source: Abdo's two WhatsApp voice replies supplied by the project owner. Note 1 (19:22:09) covers who counts the drawer and the business day. Note 2 (19:22:20) covers close and correction authority and payment methods. This is a summary of the decisions. The audio remains private.

## Confirmed workflow

| Question | Abdo's answer | Apply in Phase 4 |
|---|---|---|
| Who counts the drawer? | Abdo, the branch manager, counts it in the current workflow. | Record the actual counter, their role and count time. Record the cashier and the user who enters the data separately. The manager is the physical counter in the confirmed Maarif workflow. Do not infer a universal distinct-person constraint from the role names. This answers P1-19. |
| When does a business day end? | The normal operating day runs until 02:00. An entry at 01:00 still belongs to the business day that started before midnight. Abdo can perform the close at 02:00 or 03:00 for that same day. | Use 02:00 as the normal cutoff in the branch's configured local time. Keep the business date separate from the actual close timestamp. A close performed late still closes the intended open business day. The example of a late close does not establish a rule for sales after the normal cutoff. |
| Who closes and corrects a day? | Abdo, as manager, closes the day. If he finds an error after closing, he corrects it and approves the correction himself. | Require the appropriate branch permissions for close and correction approval. The same authorized manager can make and approve the correction. Record both actions and the reason. Keep the original posting and record a linked correction. |
| What payments does the branch accept? | Cash and Visa/card only. | Use cash and card for the initial Maarif close. Use the POS cash figure for receipts into the drawer. Card payments do not add cash to the drawer. Other payment methods are outside this confirmed workflow. |

## Implementation handoff

- Start from updated main and read the [Phase 4 plan](../IMPLEMENTATION_PLAN.md#phase-4--daily-close-cash-reconciliation-and-yawmeya) and [handover](../HANDOFF.md). Preserve Phase 3's live permission checks for pages, writes, and downloads. Distinguish the cashier, counter, person entering the record, and approver in saved data.
- Replace the prototype's midnight rollover with the configured 02:00 cutoff for Maarif. Use one authoritative business-date calculation in the branch's timezone, Africa/Casablanca. Check the timezone data caveat in the handover and test the boundary around midnight and 02:00. Include a close at 03:00 that retains the intended prior business date.
- Apply the previously approved pre-remittance rule. A later bank remittance is recorded once and leaves the earlier cash count variance intact. Run the private 2 November reference case and the synthetic regression checks from the plan.
- The prototype's report fields ST-09 and LG-08 have pending implementation. Use the confirmed counter rule here when implementing both fields. The six imported Phase 1 review responses remain the historical baseline.

## ملخص رد عبدو

1. مدير الفرع، عبدو، هو اللي بيعدّ الخزينة. نسجّل القائم بالعدّ والكاشير كل واحد في خانته.
2. يوم الشغل في العادي لحد الساعة ٢ صباحًا بتوقيت الفرع، واللي يحصل الساعة ١ بعد نص الليل يتحسب على اليوم اللي بدأ قبل نص الليل. لو عمل التقفيل الساعة ٣، التقفيل نفسه يفضل تابع لنفس يوم الشغل.
3. عبدو هو اللي بيقفل اليوم. لو ظهر غلط بعد التقفيل، هو اللي بيصحّح وهو اللي بيعتمد التصحيح.
4. الدفع كاش وفيزا بس.
