# 📊 Business Tracker — SillyTavern Extension

Tracks money, companies, projects, and jobs per chat with global settings.

---

## Installation

1. Copy the `business-tracker/` folder into your SillyTavern extensions directory:
   ```
   SillyTavern/public/scripts/extensions/third-party/business-tracker/
   ```

2. Restart SillyTavern (or reload the page).

3. Go to **Extensions** → enable **Business Tracker**.

4. Click **📊 Business Tracker** in the Extensions menu to open the panel.

---

## Features

### 💰 Finance Tab
- **Shared Economy** — one wallet for the world/RP economy
- **User (You)** — your personal wallet
- **Per-character wallets** — auto-populated from characters in the active chat
- **Dual currency** — real (e.g. AUD $) and custom (e.g. Credits ₢) side by side
- **Transaction log** — log any money movement, optionally transfer funds between wallets
- **Wallet adjustments** — add, subtract, or set exact values with a note

### 🏢 Companies Tab
- Add companies with type, relation (Employer / Client / Rival etc.), contacts, and notes
- Edit or delete at any time

### 📁 Projects Tab
- Track projects with status, company link, due date, real + custom budget/earned
- Filter by status
- Full edit/delete

### 💼 Jobs Tab
- Track jobs assigned to user or a specific character
- Pay rate with configurable period (hour / day / week / month / flat / mission)
- Real or custom currency per job
- Start & end dates, status, notes
- Filter by status

---

## Data Scope

| Data | Scope |
|---|---|
| Wallets, transactions, companies, projects, jobs | Per-chat (stored in chat metadata) |
| Currency names/symbols, panel position/width, default scope | Global (stored in extension settings) |

---

## Global Settings (⚙ button)
- Real currency code (e.g. `AUD`) and symbol (e.g. `$`)
- Custom currency name (e.g. `Credits`) and symbol (e.g. `₢`)
- Default economy scope

---

## Panel
- Fixed to the **right side** of the screen
- **Drag** via the `⠿` handle to move it up/down
- **Resize** horizontally by dragging the left edge
- Position and width are saved globally across sessions

---

## Statuses
| Status | Meaning |
|---|---|
| ▶ Active | Currently in progress |
| ◌ Pending | Not started yet |
| ⏸ On Hold | Paused |
| ✔ Completed | Done |
| ✖ Failed | Cancelled or failed |
