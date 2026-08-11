/** Explicit, idempotent trigger installer. Nothing calls this automatically. */
function installTimeTrigger(): void {
  const config = getAppConfig("DRIVE");
  const existing = getRunSorterTimeTriggers();
  if (existing.length > 0) {
    console.log(
      safeJsonStringify({
        timestamp: isoTimestamp(),
        event: "TRIGGER_INSTALL",
        action: "SKIP",
        reason: "A runSorter clock trigger already exists for this user.",
        existingCount: existing.length,
      }),
    );
    return;
  }

  ScriptApp.newTrigger("runSorter")
    .timeBased()
    .everyMinutes(config.triggerMinutes)
    .create();
  console.log(
    safeJsonStringify({
      timestamp: isoTimestamp(),
      event: "TRIGGER_INSTALL",
      action: "CREATE",
      handler: "runSorter",
      everyMinutes: config.triggerMinutes,
    }),
  );
}

/** Remove only clock triggers whose handler is exactly runSorter. */
function removeTimeTriggers(): void {
  const triggers = getRunSorterTimeTriggers();
  triggers.forEach((trigger) => ScriptApp.deleteTrigger(trigger));
  console.log(
    safeJsonStringify({
      timestamp: isoTimestamp(),
      event: "TRIGGER_REMOVE",
      handler: "runSorter",
      removedCount: triggers.length,
      unrelatedTriggersRemoved: 0,
    }),
  );
}

function getRunSorterTimeTriggers(): GoogleAppsScript.Script.Trigger[] {
  return ScriptApp.getProjectTriggers().filter(
    (trigger) =>
      trigger.getHandlerFunction() === "runSorter" &&
      trigger.getEventType() === ScriptApp.EventType.CLOCK,
  );
}

