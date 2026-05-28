## Task-Specific Behavior

Implement warehouse shipment allocation with item lots.

Response shapes:

- Item: `{ "id", "sku", "name", "reorderPoint", "createdAt" }`
- Lot: `{ "id", "itemId", "lotCode", "quantityRemaining", "expiresAt", "createdAt" }`
- Shipment: `{ "id", "reference", "status", "totalUnits", "allocations", "createdAt" }`
- Allocation: `{ "sku", "lotCode", "quantity" }`
- Availability: `{ "itemId", "totalAvailable", "lowStock", "lots" }`

Rules:

- SKUs are unique.
- Lot codes are unique per item.
- Shipment references are unique.
- Shipment lines must be allocated by earliest `expiresAt` first.
- A shipment is atomic: if any line cannot be fully allocated, return `409` and
  do not change any lot quantity.
- Canceling a shipment restores exactly the quantities consumed from each lot.
- Canceled shipments cannot be canceled again.
- `lowStock` is true when `totalAvailable <= reorderPoint`.
- Availability lots are ordered by `expiresAt` ascending and include current
  `quantityRemaining`.
