import { getTeslaStoreLabel } from './tesla-stores';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as readline from 'readline';

// Define constants
const CLIENT_ID = 'ownerapi';
const REDIRECT_URI = 'https://auth.tesla.com/void/callback';
const AUTH_URL = 'https://auth.tesla.com/oauth2/v3/authorize';
const TOKEN_URL = 'https://auth.tesla.com/oauth2/v3/token';
const SCOPE = 'openid email offline_access';
const CODE_CHALLENGE_METHOD = 'S256';
const STATE = crypto.randomBytes(16).toString('hex');
const TOKEN_FILE = 'tesla_tokens.json';
const ORDERS_FILE = 'tesla_orders.json';
const APP_VERSION = '9.99.9-9999'; // we can use a dummy version here, as the API does not check it strictly

// ANSI color codes
const colors = {
  cyan: '\x1b[94m',
  yellow: '\x1b[93m',
  gray: '\x1b[90m',
  red: '\x1b[91m',
  green: '\x1b[92m',
  reset: '\x1b[0m',
};

function colorText(text: string, colorCode: string): string {
  return `${colorCode}${text}${colors.reset}`;
}

function generateCodeVerifierAndChallenge(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = crypto.randomBytes(32)
    .toString('base64url');

  const codeChallenge = crypto.createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');

  return { codeVerifier, codeChallenge };
}

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function getAuthCode(codeChallenge: string): Promise<string> {
  const authParams = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    state: STATE,
    code_challenge: codeChallenge,
    code_challenge_method: CODE_CHALLENGE_METHOD,
  });

  const authUrl = `${AUTH_URL}?${authParams.toString()}`;
  console.log(colorText('> Opening the browser for authentication:', colors.cyan), authUrl);

  // Open browser (Bun supports this)
  await Bun.spawn(['open', authUrl], { stdio: ['inherit', 'inherit', 'inherit'] });

  console.log(colorText(
    "After authentication, you'll be redirected to a new URL. The page might show a 'Page Not Found' error message, but the URL itself is still valid for this purpose.",
    colors.gray
  ));

  const redirectedUrl = await prompt(colorText('Please enter the redirected URL here: ', colors.yellow));
  const url = new URL(redirectedUrl);
  const code = url.searchParams.get('code');

  if (!code) {
    throw new Error('No authorization code found in the URL');
  }

  return code;
}

async function exchangeCodeForTokens(authCode: string, codeVerifier: string): Promise<any> {
  const tokenData = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code: authCode,
    redirect_uri: REDIRECT_URI,
    code_verifier: codeVerifier,
  });

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: tokenData.toString(),
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.statusText}`);
  }

  return await response.json();
}

function saveTokensToFile(tokens: any): void {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
  console.log(colorText(`> Tokens saved to '${TOKEN_FILE}'`, colors.cyan));
}

function loadTokensFromFile(): any {
  const data = fs.readFileSync(TOKEN_FILE, 'utf-8');
  return JSON.parse(data);
}

function isTokenValid(accessToken: string): boolean {
  try {
    const parts = accessToken.split('.');
    if (parts.length !== 3) return false;

    // Decode JWT payload (add padding if needed)
    let payload = parts[1];
    while (payload.length % 4 !== 0) {
      payload += '=';
    }

    const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf-8'));
    return decoded.exp > Math.floor(Date.now() / 1000);
  } catch (error) {
    return false;
  }
}

async function refreshTokens(refreshToken: string): Promise<any> {
  const tokenData = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    refresh_token: refreshToken,
  });

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: tokenData.toString(),
  });

  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.statusText}`);
  }

  return await response.json();
}

async function retrieveOrders(accessToken: string): Promise<any[]> {
  const response = await fetch('https://owner-api.teslamotors.com/api/1/users/orders', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to retrieve orders: ${response.statusText}`);
  }

  const data = await response.json();
  return data.response;
}

async function getOrderDetails(orderId: string, accessToken: string): Promise<any> {
  const url = `https://akamai-apigateway-vfx.tesla.com/tasks?deviceLanguage=en&deviceCountry=DE&referenceNumber=${orderId}&appVersion=${APP_VERSION}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get order details: ${response.statusText}`);
  }

  return await response.json();
}

function saveOrdersToFile(orders: any[]): void {
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
  console.log(colorText(`\n> Orders saved to '${ORDERS_FILE}'`, colors.cyan));
}

function loadOrdersFromFile(): any[] | null {
  if (fs.existsSync(ORDERS_FILE)) {
    const data = fs.readFileSync(ORDERS_FILE, 'utf-8');
    return JSON.parse(data);
  }
  return null;
}

function compareDicts(oldDict: any, newDict: any, path: string = ''): string[] {
  const differences: string[] = [];

  for (const key in oldDict) {
    if (!(key in newDict)) {
      differences.push(colorText(`- Removed key '${path}${key}'`, colors.red));
    } else if (typeof oldDict[key] === 'object' && oldDict[key] !== null &&
               typeof newDict[key] === 'object' && newDict[key] !== null &&
               !Array.isArray(oldDict[key]) && !Array.isArray(newDict[key])) {
      differences.push(...compareDicts(oldDict[key], newDict[key], `${path}${key}.`));
    } else if (oldDict[key] !== newDict[key]) {
      differences.push(colorText(`- ${path}${key}: ${oldDict[key]}`, colors.red));
      differences.push(colorText(`+ ${path}${key}: ${newDict[key]}`, colors.green));
    }
  }

  for (const key in newDict) {
    if (!(key in oldDict)) {
      differences.push(colorText(`+ Added key '${path}${key}': ${newDict[key]}`, colors.green));
    }
  }

  return differences;
}

function compareOrders(oldOrders: any[], newOrders: any[]): string[] {
  const differences: string[] = [];

  for (let i = 0; i < oldOrders.length; i++) {
    if (i < newOrders.length) {
      differences.push(...compareDicts(oldOrders[i], newOrders[i], `Order ${i}.`));
    } else {
      differences.push(colorText(`- Removed order ${i}`, colors.red));
    }
  }

  for (let i = oldOrders.length; i < newOrders.length; i++) {
    differences.push(colorText(`+ Added order ${i}`, colors.green));
  }

  return differences;
}

function printOrderInformation(detailedOrders: any[]): void {
  for (const detailedOrder of detailedOrders) {
    const order = detailedOrder.order;
    const orderDetails = detailedOrder.details;
    const scheduling = orderDetails?.tasks?.scheduling || {};
    const orderInfo = orderDetails?.tasks?.registration?.orderDetails || {};
    const finalPaymentData = orderDetails?.tasks?.finalPayment?.data || {};

    console.log(`\n${'-'.repeat(45)}`);
    console.log(`${'ORDER INFORMATION'.padStart(29).padEnd(45)}`);
    console.log(`${'-'.repeat(45)}`);

    console.log(colorText('Order Details:', colors.cyan));
    console.log(`${colorText('- Order ID:', colors.cyan)} ${order.referenceNumber}`);
    console.log(`${colorText('- Status:', colors.cyan)} ${order.orderStatus}`);
    console.log(`${colorText('- Model:', colors.cyan)} ${order.modelCode}`);
    console.log(`${colorText('- VIN:', colors.cyan)} ${order.vin || 'N/A'}`);

    console.log(`\n${colorText('Reservation Details:', colors.cyan)}`);
    console.log(`${colorText('- Reservation Date:', colors.cyan)} ${orderInfo.reservationDate || 'N/A'}`);
    console.log(`${colorText('- Order Booked Date:', colors.cyan)} ${orderInfo.orderBookedDate || 'N/A'}`);

    console.log(`\n${colorText('Vehicle Status:', colors.cyan)}`);
    console.log(`${colorText('- Vehicle Odometer:', colors.cyan)} ${orderInfo.vehicleOdometer || 'N/A'} ${orderInfo.vehicleOdometerType || 'N/A'}`);

    console.log(`\n${colorText('Delivery Information:', colors.cyan)}`);
    const routingLocation = orderInfo.vehicleRoutingLocation || 0;
    console.log(`${colorText('- Routing Location:', colors.cyan)} ${routingLocation} (${getTeslaStoreLabel(routingLocation)})`);
    console.log(`${colorText('- Delivery Window:', colors.cyan)} ${scheduling.deliveryWindowDisplay || 'N/A'}`);
    console.log(`${colorText('- ETA to Delivery Center:', colors.cyan)} ${finalPaymentData.etaToDeliveryCenter || 'N/A'}`);
    console.log(`${colorText('- Delivery Appointment:', colors.cyan)} ${scheduling.apptDateTimeAddressStr || 'N/A'}`);

    console.log(`${'-'.repeat(45)}\n`);
  }
}

// Main script logic
async function main() {
  console.log(colorText('\n> Start retrieving the information. Please be patient...\n', colors.cyan));

  const { codeVerifier, codeChallenge } = generateCodeVerifierAndChallenge();
  let accessToken: string;
  let refreshToken: string;

  if (fs.existsSync(TOKEN_FILE)) {
    try {
      const tokenFile = loadTokensFromFile();
      accessToken = tokenFile.access_token;
      refreshToken = tokenFile.refresh_token;

      if (!isTokenValid(accessToken)) {
        console.log(colorText('> Access token is not valid. Refreshing tokens...', colors.cyan));
        const tokenResponse = await refreshTokens(refreshToken);
        accessToken = tokenResponse.access_token;
        // refresh access token in file
        tokenFile.access_token = accessToken;
        saveTokensToFile(tokenFile);
      }
    } catch (error) {
      console.log(colorText('> Error loading tokens from file. Re-authenticating...', colors.cyan));
      const authCode = await getAuthCode(codeChallenge);
      const tokenResponse = await exchangeCodeForTokens(authCode, codeVerifier);
      accessToken = tokenResponse.access_token;
      refreshToken = tokenResponse.refresh_token;
      saveTokensToFile(tokenResponse);
    }
  } else {
    const authCode = await getAuthCode(codeChallenge);
    const tokenResponse = await exchangeCodeForTokens(authCode, codeVerifier);
    accessToken = tokenResponse.access_token;
    refreshToken = tokenResponse.refresh_token;

    const saveTokens = await prompt(
      colorText('Would you like to save the tokens to a file in the current directory for use in future requests? (y/n): ', colors.yellow)
    );

    if (saveTokens.toLowerCase() === 'y') {
      saveTokensToFile(tokenResponse);
    }
  }

  const oldOrders = loadOrdersFromFile();
  const newOrders = await retrieveOrders(accessToken);

  // Retrieve detailed order information
  const detailedNewOrders: any[] = [];
  for (const order of newOrders) {
    const orderId = order.referenceNumber;
    const orderDetails = await getOrderDetails(orderId, accessToken);
    const detailedOrder = {
      order: order,
      details: orderDetails,
    };
    detailedNewOrders.push(detailedOrder);
  }

  if (oldOrders) {
    const differences = compareOrders(oldOrders, detailedNewOrders);
    if (differences.length > 0) {
      console.log(colorText('Differences found:', colors.gray));
      for (const diff of differences) {
        console.log(diff);
      }
      saveOrdersToFile(detailedNewOrders);
    } else {
      console.log(colorText('No differences found.', colors.gray));
    }
  } else {
    // ask user if they want to save the new orders to a file for comparison next time
    const saveOrders = await prompt(
      colorText('Would you like to save the order information to a file for future comparison? (y/n): ', colors.yellow)
    );

    if (saveOrders.toLowerCase() === 'y') {
      saveOrdersToFile(detailedNewOrders);
    }
  }

  printOrderInformation(detailedNewOrders);
}

// Run the script
main().catch((error) => {
  console.error(colorText('Error:', colors.red), error.message);
  process.exit(1);
});
