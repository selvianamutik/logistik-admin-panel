import re

with open("D:\\Work\\Web\\logistik-admin-panel\\src\\app\\(admin)\\_components\\TripDetailPage.tsx", "r", encoding="utf-8") as f:
    c = f.read()

# 1. Add state deletedShipperReferenceItemIds
c = c.replace(
    "    const [shipperReferenceExistingItemDraftMap, setShipperReferenceExistingItemDraftMap] = useState<Record<string, ExistingShipperReferenceItemDraft[]>>({});",
    "    const [shipperReferenceExistingItemDraftMap, setShipperReferenceExistingItemDraftMap] = useState<Record<string, ExistingShipperReferenceItemDraft[]>>({});\n    const [deletedShipperReferenceItemIds, setDeletedShipperReferenceItemIds] = useState<string[]>([]);"
)

# 2. Reset state on modal open
c = c.replace(
    "        setShipperReferenceModalMode(mode);",
    "        setShipperReferenceModalMode(mode);\n        setDeletedShipperReferenceItemIds([]);"
)

# 3. Add delete API call loop inside saveShipperReference
delete_loop = """            for (const itemId of deletedShipperReferenceItemIds) {
                const cargoDeleteRes = await fetch('/api/data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        entity: 'delivery-orders',
                        action: 'remove-cargo-item',
                        data: {
                            id: doData?._id,
                            deliveryOrderItemId: itemId,
                        },
                    }),
                });
                if (!cargoDeleteRes.ok) {
                    const cargoDeleteResult = await cargoDeleteRes.json();
                    addToast('error', cargoDeleteResult.error || 'Gagal menghapus beberapa barang lama.');
                    return;
                }
            }
"""
c = c.replace(
    "                if (!cargoUpdateRes.ok) {\n                    addToast('error', cargoUpdateResult.error || 'SJ tersimpan, tapi gagal memperbarui barang terdaftar.');\n                    return;\n                }\n            }\n            setShowShipperReferenceModal(false);",
    "                if (!cargoUpdateRes.ok) {\n                    addToast('error', cargoUpdateResult.error || 'SJ tersimpan, tapi gagal memperbarui barang terdaftar.');\n                    return;\n                }\n            }\n" + delete_loop + "            setShowShipperReferenceModal(false);"
)

# 4. Modify the onClick behavior of the delete button
old_button = """                                                                    onClick={() => void removeCargoItem(item.deliveryOrderItemId, item.description || 'barang ini')}
                                                                    disabled={Boolean(removingCargoItemId) || savingCargo || savingShipperReference}
                                                                    style={{ color: 'var(--color-danger-700)' }}
                                                                    title="Hapus barang ini dari Surat Jalan"
                                                                >
                                                                    {removingCargoItemId === item.deliveryOrderItemId ? 'Menghapus...' : 'Hapus'}"""

new_button = """                                                                    onClick={() => {
                                                                        setShipperReferenceExistingItemDraftMap(prev => {
                                                                            const next = { ...prev };
                                                                            if (selectedShipperReferenceDraft && next[selectedShipperReferenceDraft.draftKey]) {
                                                                                next[selectedShipperReferenceDraft.draftKey] = next[selectedShipperReferenceDraft.draftKey].filter(i => i.deliveryOrderItemId !== item.deliveryOrderItemId);
                                                                            }
                                                                            return next;
                                                                        });
                                                                        setDeletedShipperReferenceItemIds(prev => [...prev, item.deliveryOrderItemId]);
                                                                    }}
                                                                    disabled={savingShipperReference}
                                                                    style={{ color: 'var(--color-danger-700)' }}
                                                                    title="Hapus barang ini dari Surat Jalan (disimpan saat klik Simpan)"
                                                                >
                                                                    Hapus"""

c = c.replace(old_button, new_button)

with open("D:\\Work\\Web\\logistik-admin-panel\\src\\app\\(admin)\\_components\\TripDetailPage.tsx", "w", encoding="utf-8") as f:
    f.write(c)

print("Patched!")
