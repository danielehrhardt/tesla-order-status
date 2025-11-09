# Tesla Order Status Checker

A TypeScript application for tracking your Tesla order status using the Tesla API. Available as both a CLI tool and a web application.


https://tesla-order-status.codext.de

<img width="1061" height="978" alt="image" src="https://github.com/user-attachments/assets/f005db0c-d05a-4aba-9514-89657a331010" />


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

### Web Application (NEW!)

Start the web server:
```bash
bun start
# or
bun dev
```

Then open your browser and navigate to: http://localhost:3456

The web version features:
- Modern, responsive UI with dark theme
- Browser-based authentication flow
- Local storage for tokens and order history
- Real-time order comparison
- Auto-refresh capabilities
- No server-side storage - everything stays in your browser

> **Note for iPhone users:** Please disable Safari's pop-up blocker or the Tesla login window will be blocked. On your iPhone, open **Settings → Safari** and enable **Allow Pop-ups**.

### CLI Version

Run the CLI script:
```bash
bun cli
# or directly
bun tesla-order-status.ts
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

### Core Files
- `tesla-order-status.ts` - CLI version script
- `tesla-stores.ts` - Tesla store locations enum and helper functions

### Web Application Files
- `server.ts` - Bun web server with API endpoints
- `index.html` - HTML entry point
- `frontend.tsx` - React frontend application
- `styles.css` - Modern UI styles

### Data Files (auto-generated)
- `tesla_tokens.json` - Saved authentication tokens (CLI version)
- `tesla_orders.json` - Saved order data for comparison (CLI version)
- Browser LocalStorage - Tokens and orders (Web version)

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

## Credits

This project is a fork of the original [Tesla Order Status](https://github.com/niklaswa/tesla-order-status) by [niklaswa](https://github.com/niklaswa).

---

This project was created using `bun init` in bun v1.2.21. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
