## Task-Specific Behavior

Implement a clinic scheduling API with patients, doctors, availability windows,
appointments, cancellation, and summaries.

Authentication uses `Authorization: Token <token>`.

User response:

```json
{ "id": "string", "username": "string", "token": "string", "createdAt": "ISO-8601 string" }
```

Doctor response:

```json
{ "id": "string", "code": "cardio", "name": "Dr Heart", "createdAt": "ISO-8601 string" }
```

Availability response:

```json
{ "id": "string", "doctorId": "string", "startsAt": "ISO-8601 string", "endsAt": "ISO-8601 string" }
```

Appointment response:

```json
{
  "id": "string",
  "doctorId": "string",
  "patientId": "string",
  "startsAt": "ISO-8601 string",
  "endsAt": "ISO-8601 string",
  "status": "booked",
  "reason": "string",
  "createdAt": "ISO-8601 string"
}
```

Scheduling rules:

- Appointment times are half-open intervals: `[startsAt, endsAt)`.
- A booking must fit entirely inside one availability window for the doctor.
- Bookings for the same doctor must not overlap other booked appointments.
- Adjacent appointments are allowed when one ends exactly when the next starts.
- Canceled appointments no longer block the slot.
- Only the patient who owns an appointment can read it through their appointment
  list or cancel it.

Doctor schedule response:

```json
{
  "doctorId": "string",
  "bookedCount": 1,
  "canceledCount": 0,
  "appointments": ["appointment-id"]
}
```

