# Domain Model

## Core Entities

### Customer
Represents a company or individual receiving services.

### Contract
Defines SLA, pricing, service scope and validity period.

### AssetLocation
Physical location where equipment is installed.

### Equipment
Tracked service object.
Attributes:
- serial number
- model
- QR code
- maintenance history

### Ticket
Central business entity.

Relations:
- belongs to Customer
- belongs to AssetLocation
- optionally linked to Equipment
- assigned to User or Group

### Comment
Communication record.

### Attachment
File attached to Ticket or Comment.

### Checklist
Work validation form.

### User
System employee.

### Group
Service team.

### Warehouse
Physical or virtual stock location.

### Nomenclature
Inventory catalog item.

### AccountingDocument
Inventory transaction document.
