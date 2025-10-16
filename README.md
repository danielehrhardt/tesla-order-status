# Tesla Order Status Checker

A TypeScript script for Bun that fetches and tracks your Tesla order status using the Tesla API.

## Features

- OAuth2 PKCE authentication with Tesla
- Automatic token management (save, load, refresh)
- Fetch Tesla order details
- Track changes between runs
- Display formatted order information including:
  - Order details (ID, status, model, VIN)
  - Reservation and booking dates
  - Vehicle odometer
  - Delivery information (location, window, ETA, appointment)

## Installation

1. Install Bun (if not already installed):
```bash
curl -fsSL https://bun.sh/install | bash
```

2. No additional dependencies needed - Bun includes everything required!

## Usage

Run the script:
```bash
bun run tesla-order-status.ts
```

### First Run

On first run, the script will:
1. Open your browser for Tesla authentication
2. Redirect you to a URL (may show "Page Not Found" - this is normal)
3. Ask you to paste the redirected URL
4. Optionally save tokens for future use
5. Display your order information
6. Optionally save order data for change tracking

### Subsequent Runs

- Automatically uses saved tokens
- Refreshes expired tokens
- Compares with previous order data to show changes
- Displays updated order information

## Files

- `tesla-order-status.ts` - Main script
- `tesla-stores.ts` - Tesla store locations enum
- `tesla_tokens.json` - Saved authentication tokens (created after first run)
- `tesla_orders.json` - Saved order data for comparison (created after first run)

## Preview

### Main Information
The script displays:
- Order ID and status
- Vehicle model and VIN
- Reservation and booking dates
- Vehicle odometer reading
- Delivery location and appointment details

### Change Tracking
When run multiple times, the script shows:
- New fields added (in green)
- Removed fields (in red)
- Changed values (red for old, green for new)

## Notes

- Tokens and order data are saved locally in the current directory
- The script uses Tesla's official OAuth2 flow
- Browser must be opened manually on first authentication
- `open` command is used to launch the browser (macOS compatible)

## Security

- Never commit `tesla_tokens.json` to version control
- Tokens are stored locally and refreshed automatically
- Uses secure OAuth2 PKCE flow

---

This project was created using `bun init` in bun v1.2.21. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
