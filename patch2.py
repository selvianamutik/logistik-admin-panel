import re

with open("D:\\Work\\Web\\logistik-admin-panel\\src\\lib\\api\\order-workflows.ts", "r", encoding="utf-8") as f:
    c = f.read()

# Fix normalizeDeliveryOrderShipperReferencesForUpdate to trust _key regardless of referenceNumber changes
old_code = """                const byRequestedKeyIndex = requestedReferenceKey
                    ? existingReferences.findIndex((item, candidateIndex) =>
                        !usedExistingReferenceIndexes.has(candidateIndex) &&
                        normalizeOptionalText(item._key) === requestedReferenceKey &&
                        (
                            normalizeOptionalText(item.referenceNumber)?.toUpperCase() === referenceNumber ||
                            !normalizeOptionalText(item.referenceNumber)
                        )
                    )
                    : -1;"""

new_code = """                const byRequestedKeyIndex = requestedReferenceKey
                    ? existingReferences.findIndex((item, candidateIndex) =>
                        !usedExistingReferenceIndexes.has(candidateIndex) &&
                        normalizeOptionalText(item._key) === requestedReferenceKey
                    )
                    : -1;"""

if old_code in c:
    c = c.replace(old_code, new_code)
    with open("D:\\Work\\Web\\logistik-admin-panel\\src\\lib\\api\\order-workflows.ts", "w", encoding="utf-8") as f:
        f.write(c)
    print("Patched normalizeDeliveryOrderShipperReferencesForUpdate!")
else:
    print("Could not find the target code to patch.")

