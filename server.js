const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const fs = require('fs');

// Use the stealth plugin
puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;


app.use(express.json()); // To parse JSON request bodies
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files (your frontend)

// --- Puppeteer Helper Functions (from your script) ---
let monitoringPaused = false;
function pauseMonitoringFor(ms) {
    monitoringPaused = true;
    setTimeout(() => monitoringPaused = false, ms);
}

async function waitForLoadingToFinish(page, timeout = 30000) {
    try {
        await page.waitForFunction(() => {
            const el = document.querySelector('#root > div.__loader__container');
            return !el;
        }, { timeout });
        return true; // Spinner disappeared
    } catch (err) {
        console.warn("Spinner did not disappear within timeout.");
        return false; // Spinner did not disappear
    }
}

async function safeClick(page, selector, label = '') {
    try {
        // if (!(await waitForLoadingToFinish(page))) {
        //     console.warn(`⚠️ Loading stuck before clicking ${label || selector}. Attempting click anyway.`);
        // }
        await waitForLoadingToFinish(page)
        await page.waitForSelector(selector, { timeout: 10000 });
        await page.click(selector);
        console.log(`✅ Clicked: ${label || selector}`);
        return true;
    } catch (err) {
        console.warn(`⚠️ Could not click ${label || selector}:`, err.message);
        return false;
    }
}

async function safeSelect(page, selector, value, label = '') {
    try {
        // if (!(await waitForLoadingToFinish(page))) {
        //     console.warn(`⚠️ Loading stuck before selecting ${label || selector}. Attempting select anyway.`);
        // }
        await waitForLoadingToFinish(page)
        await page.waitForSelector(selector, { timeout: 10000 });
        await page.select(selector, value);
        console.log(`✅ Selected "${value}" for: ${label || selector}`);
        return true;
    } catch (err) {
        console.warn(`⚠️ Could not select "${value}" for ${label || selector}:`, err.message);
        return false;
    }
}

async function safeType(page, selector, value, label = '') {
    try {
        // if (!(await waitForLoadingToFinish(page))) {
        //     console.warn(`⚠️ Loading stuck before typing into ${label || selector}. Attempting type anyway.`);
        // }
        await waitForLoadingToFinish(page)
        await page.waitForSelector(selector);
        await page.type(selector, value, { delay: 100 });
        console.log(`✅ Typed into: ${label || selector}`);
        return true;
    } catch (err) {
        console.warn(`⚠️ Could not type into ${label || selector}:`, err.message);
        return false;
    }
}

async function getCallPutSellButtonSelectors(page) {
    await waitForLoadingToFinish(page);
    try {
        return await page.evaluate(() => {
            const rows = document.querySelectorAll('#optionChainTable > div > table > tr');
            let callSelector = null;
            let putSelector = null;

            rows.forEach((tr, rowIndex) => {
                const tds = tr?.querySelectorAll('td') || [];
                tds.forEach((td, colIndex) => {
                    const button = td?.querySelector('button.sell_button.highlight_action_button');
                    if (button) {
                        const isFirst = colIndex === 0;
                        const isLast = colIndex === tds.length - 1;

                        const selector = `#optionChainTable > div > table > tr:nth-child(${rowIndex + 1}) > td:nth-child(${colIndex + 1}) > div > div.dropdown > div:nth-child(1) > button`;
                        if (isFirst && !callSelector) {
                            callSelector = selector;
                            console.log("call selector: ", callSelector);
                        } else if (isLast && !putSelector) {
                            putSelector = selector;
                            console.log("put selector: ", putSelector);
                        }
                    }
                });
            });
            return { callSelector, putSelector };
        });
    } catch (err) {
        console.error("getCallPutSellButtonSelectors failed:", err.message);
        return { callSelector: null, putSelector: null };
    }
}

async function getLTPs(page, callSelector, putSelector) {
    await waitForLoadingToFinish(page);
    try {
        return await page.evaluate((cs, ps) => {
            const callsellBtn = document.querySelector(cs);
            const putsellBtn = document.querySelector(ps);
            if (!callsellBtn || !putsellBtn) return { callLTP: null, putLTP: null };

            const call_tr = callsellBtn.closest('tr');
            const put_tr = putsellBtn.closest('tr');

            const callTd = call_tr?.querySelector('td.call_ltp');
            const putTd = put_tr?.querySelector('td.put_ltp');

            const callLTP = callTd?.childNodes[0]?.textContent.trim().replace(/['"]+/g, '') || null;
            const putLTP = putTd?.childNodes[0]?.textContent.trim().replace(/['"]+/g, '') || null;

            return { callLTP: callLTP !== null ? parseFloat(callLTP) : null, putLTP: putLTP !== null ? parseFloat(putLTP) : null };
        }, callSelector, putSelector);
    } catch (err) {
        console.error("getLTPs failed:", err.message);
        return { callLTP: null, putLTP: null };
    }
}

async function getTimehr(page) {
    await waitForLoadingToFinish(page);
    try {
        return await page.evaluate(() => {
            const dropdown = document.querySelector('#root > div.__page.simulator_page > div > div > div.simulator__config__box.__no__print > div > div > div.col.time_box > div.time_interval.mx-1 > select.__box__input.mr-1');
            if (!dropdown || !dropdown.options || dropdown.selectedIndex === -1) return { time_hr: null };
            const selectedOption = dropdown.options[dropdown.selectedIndex];
            return {
                time_hr: parseInt(selectedOption.text)
            };
        });
    } catch (err) {
        console.error("getTimehr failed:", err.message);
        return { time_hr: null };
    }
}

async function getTimemin(page) {
    await waitForLoadingToFinish(page);
    try {
        return await page.evaluate(() => {
            const dropdown = document.querySelector('#root > div.__page.simulator_page > div > div > div.simulator__config__box.__no__print > div > div > div.col.time_box > div.time_interval.mx-1 > select:nth-child(3)');
            if (!dropdown || !dropdown.options || dropdown.selectedIndex === -1) return { time_min: null };
            const selectedOption = dropdown.options[dropdown.selectedIndex];
            return {
                time_min: parseInt(selectedOption.text)
            };
        });
    } catch (err) {
        console.error("getTimemin failed:", err.message);
        return { time_min: null };
    }
}

async function getTotalPnL(page) {
    await waitForLoadingToFinish(page);
    try {
        return await page.evaluate(() => {
            let el = document.querySelector(
                '#root > div.__page.simulator_page > div > div > div.simulator__result__box > div.row.simulator_content > div.simulator_box.simulator_result_box > div > div.eod__message.row.simulator__stats > div:nth-child(2) > div.simulator_red_text > span.expiry_indicator'
            );
            if (!el) {
                el = document.querySelector(
                    '#root > div.__page.simulator_page > div > div > div.simulator__result__box > div.row.simulator_content > div.simulator_box.simulator_result_box > div > div.eod__message.row.simulator__stats > div:nth-child(2) > div.simulator_green_text > span.expiry_indicator'
                );
            }
            const value = el ? parseFloat(el.textContent.trim().replace(/[()%]/g, '')) : null;
            return { total_pnl_value: value }
        });
    } catch (err) {
        console.error("getTotalPnL failed:", err.message);
        return { total_pnl_value: null };
    }
}

async function getHighlightAtmSellButtons(page) {
    await waitForLoadingToFinish(page);
    try {
        return await page.evaluate(() => {
            const atmRow = document.querySelector('#optionChainTable > div > table > tr.highlight_atm');
            if (!atmRow) {
                return {
                    call: { selector: null, isSelected: false },
                    put: { selector: null, isSelected: false }
                };
            }

            const tds = atmRow?.querySelectorAll('td') || [];
            const result = {
                call: { selector: null, isSelected: false },
                put: { selector: null, isSelected: false }
            };

            tds.forEach((td, index) => {
                const btn = td?.querySelector('button.sell_button');
                if (btn && btn.textContent.trim().startsWith('S')) {
                    if (btn.classList.contains('highlight_action_button')) {
                        var isSelected = true;
                        var selector = `#optionChainTable > div > table > tr.highlight_atm > td:nth-child(${index + 1}) > div > div.dropdown > div:nth-child(1) > button`;
                    }
                    else {
                        var isSelected = false;
                        var selector = `#optionChainTable > div > table > tr.highlight_atm > td:nth-child(${index + 1}) > div > button.sell_button`;
                    }

                    if (index === 0) {
                        result.call = { selector, isSelected };
                    } else if (index === tds.length - 1) {
                        result.put = { selector, isSelected };
                    }
                }
            });
            return result;
        });
    } catch (err) {
        console.error("getHighlightAtmSellButtons failed:", err.message);
        return {
            call: { selector: null, isSelected: false },
            put: { selector: null, isSelected: false }
        };
    }
}

function monitorLoadingStuck(page, onStuckCallback) {
    let stuckSince = null;
    const checkInterval = 2000; // every 2 sec
    const timeoutThreshold = 30000; // 10 sec

    if (page._loadingMonitorInterval) {
        clearInterval(page._loadingMonitorInterval);
    }

    page._loadingMonitorInterval = setInterval(async () => {
        if (monitoringPaused) return;
        try {
            const isLoading = await page.evaluate(() => {
                const el = document.querySelector('#root > div.__loader__container');
                return !!el;
            });

            if (isLoading) {
                if (!stuckSince) stuckSince = Date.now();
                else if (Date.now() - stuckSince >= timeoutThreshold) {
                    stuckSince = null;
                    await onStuckCallback();
                }
            } else {
                stuckSince = null;
            }
        } catch (err) {
            if (err.message.includes('Execution context was destroyed')) {
                console.log("Monitor: Execution context destroyed, possibly navigation occurred.");
            } else {
                console.error("Error in monitorLoadingStuck:", err);
            }
        }
    }, checkInterval);
}

function monitorConnectionIssue(page, onConnectionLost) {
    const interval = 2000;

    if (page._connectionMonitorInterval) {
        clearInterval(page._connectionMonitorInterval);
    }

    page._connectionMonitorInterval = setInterval(async () => {
        if (monitoringPaused) return;
        try {
            const msg = await page.$eval('#desc', el => el.textContent.trim()).catch(() => null);
            if (msg && msg.includes("Please check your internet connection")) {
                console.log("Connection issue detected:", msg);
                clearInterval(page._connectionMonitorInterval);
                await onConnectionLost?.();
            }
        } catch (err) {
            if (err.message.includes('Execution context was destroyed')) {
                console.log("Monitor: Execution context destroyed, possibly navigation occurred.");
            } else {
                console.error("Error checking connection:", err.message);
            }
        }
    }, interval);
}

function cleanupMonitors(page) {
    if (page._loadingMonitorInterval) {
        clearInterval(page._loadingMonitorInterval);
        page._loadingMonitorInterval = null;
    }
    if (page._connectionMonitorInterval) {
        clearInterval(page._connectionMonitorInterval);
        page._connectionMonitorInterval = null;
    }
}

// --- Date Utility Functions ---

/**
 * Validates a date string in DD-MM-YYYY format and returns a Date object.
 * @param {string} dateString
 * @returns {Date | null}
 */
function parseDDMMYYYY(dateString) {
    const parts = dateString.split('-');
    if (parts.length !== 3) return null;

    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10); // 1-indexed month
    const year = parseInt(parts[2], 10);

    // Basic check for month and day ranges
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;

    const date = new Date(year, month - 1, day); // Month is 0-indexed for Date object
    // Check if the parsed date matches the input to catch invalid days (e.g., Feb 30)
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        return null;
    }
    return date;
}

/**
 * Formats a Date object into DD-MM-YYYY string.
 * @param {Date} date
 * @returns {string}
 */
function formatDateToDDMMYYYY(date) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0'); // Month is 0-indexed
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
}

/**
 * Generates an array of dates between a start and end date (inclusive).
 * Skips invalid dates (like Feb 30th) by using Date object's auto-correction.
 * Converts input from YYYY-MM-DD to DD-MM-YYYY for internal processing.
 * @param {string} startDateStr - YYYY-MM-DD format (from frontend)
 * @param {string} endDateStr - YYYY-MM-DD format (from frontend)
 * @returns {string[]} Array of dates in DD-MM-YYYY format
 */
function getDatesInRange(startDateStr, endDateStr) {
    const dates = [];
    // Correctly parse YYYY-MM-DD format
    const startParts = startDateStr.split('-');
    const endParts = endDateStr.split('-');

    let currentDate = new Date(parseInt(startParts[0], 10), parseInt(startParts[1], 10) - 1, parseInt(startParts[2], 10));
    const endDate = new Date(parseInt(endParts[0], 10), parseInt(endParts[1], 10) - 1, parseInt(endParts[2], 10));

    // Reset time components to avoid issues with timezones/DST affecting date comparison
    currentDate.setHours(0, 0, 0, 0);
    endDate.setHours(0, 0, 0, 0);

    while (currentDate <= endDate) {
        const formattedDate = formatDateToDDMMYYYY(currentDate);
        // We use parseDDMMYYYY to ensure it's a valid calendar date (e.g., skips Feb 30 if currentDate tried to become that)
        if (parseDDMMYYYY(formattedDate)) {
            dates.push(formattedDate);
        }
        currentDate.setDate(currentDate.getDate() + 1); // Move to the next day
        currentDate.setHours(0, 0, 0, 0); // Keep time components consistent
    }
    return dates;
}


// --- NEW: Function to select a specific date on the calendar ---
// dateString in DD-MM-YYYY format
async function selectSpecificDate(page, dateString) {
    const [dayStr, monthStr, yearStr] = dateString.split('-');
    const day = parseInt(dayStr, 10);
    const month = parseInt(monthStr, 10); // 1-indexed month
    const year = parseInt(yearStr, 10);

    console.log(`Attempting to select date: ${day}-${month}-${year}`);

    // 1. Click the calendar icon to open it
    let caldateClicked = await safeClick(page, '#root > div.__page.simulator_page > div > div > div.simulator__config__box.__no__print > div > div > div.col.time_box > div.time_interval.mx-1 > div', 'Calendar Icon');
    if (!caldateClicked) {
        console.error("Failed to open calendar. Cannot proceed with date selection.");
        return false;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
    await page.waitForSelector('div.editor.active', { timeout: 10000 }); // Wait for the calendar popup to be active

    // 2. Click the year segment to go to year view
    let calyearsegmentClicked = await safeClick(page, 'div.editor.active div.header button:nth-child(6)', 'Year Segment in Calendar');
    if (!calyearsegmentClicked) {
        console.error("Failed to click year segment. Cannot select year.");
        return false;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
    await waitForLoadingToFinish(page); // Ensure content updates

    // 3. Click the specific year
    // Stockmock seems to start years at 2017 for the 2017 button.
    // The selector is a bit tricky, it's relative to the start of the year grid.
    // We assume 2017 is the first 'button' for years
    // The nth-child index for year buttons usually starts from 1.
    
    const yearButtonIndex = year - 2016;
    const yearSelector = `#root > div.__page.simulator_page > div > div > div.simulator__config__box.__no__print > div > div > div.col.time_box > div.time_interval.mx-1 > div > div > div.editor.active > div.sled.p2 > div:nth-child(3) > div > button:nth-child(${yearButtonIndex}) > div`;

    const yearClickSuccess = await page.evaluate((selector, targetYear) => {
        const el = document.querySelector(selector);
        // Double check text content of the element as a fallback/validation
        if (el && parseInt(el.textContent.trim(), 10) === targetYear) {
            el.click();
            return true;
        }
        // Fallback for cases where the specific nth-child is off or structure changes
        const allYearButtons = document.querySelectorAll('div.editor.active .sled.p2 div:nth-child(3) > button > div');
        for (const btnDiv of allYearButtons) {
            if (parseInt(btnDiv.textContent.trim(), 10) === targetYear) {
                btnDiv.click();
                return true;
            }
        }
        return false;
    }, yearSelector, year);


    if (!yearClickSuccess) {
        console.error(`Failed to click year ${year}. Check selector or year range.`);
        return false;
    }
    console.log(`✅ Selected year: ${year}`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    await waitForLoadingToFinish(page);

    // 4. Click the specific month
    // Month buttons are typically 1-indexed based on their position in the grid (e.g., January is 1, February is 2)
    const monthSelector = `#root > div.__page.simulator_page > div > div > div.simulator__config__box.__no__print > div > div > div.col.time_box > div.time_interval.mx-1 > div > div > div.editor.active > div.sled.p1 > div:nth-child(2) > div > button:nth-child(${month})`;
    const monthClickSuccess = await safeClick(page, monthSelector, `Month ${month}`);
    if (!monthClickSuccess) {
        console.error(`Failed to click month ${month}. Selector: ${monthSelector}`);
        return false;
    }
    console.log(`✅ Selected month: ${month}`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    await waitForLoadingToFinish(page);

    // 5. Click the specific day
    const dayClickSuccess = await page.evaluate((targetDay) => {
        const buttons = document.querySelectorAll('.editor.active .sled.p0 button.day');
        for (const btn of buttons) {
            const numberDiv = btn.querySelector('.number');
            const isDisabled = btn.hasAttribute('disabled');
            const isOtherScope = btn.classList.contains('other-scope'); // Days from prev/next month

            if (!isDisabled && !isOtherScope && numberDiv?.textContent.trim() === String(targetDay)) {
                btn.click();
                return true;
            }
        }
        return false; // Day not found or was disabled/other-scope
    }, day);

    if (!dayClickSuccess) {
        console.warn(`⚠️ Day ${day} on ${dateString} was disabled or not found. Skipping this date.`);
        // Close calendar if it's still open before returning false
        // This might involve clicking outside or the calendar icon again.
        // For simplicity, we'll let the next iteration handle the calendar opening if needed.
        return false; // Indicates this date could not be selected/simulated
    }
    console.log(`✅ Selected day: ${day}`);
    await new Promise(resolve => setTimeout(resolve, 3000)); // Give time for page to update after date selection
    return true; // Date successfully selected
}


async function clearAllCookies(page) {
    try {
        const client = await page.target().createCDPSession();
        await client.send('Network.clearBrowserCookies');
        console.log('All browser cookies cleared.');
    } catch (error) {
        console.error('Error clearing browser cookies:', error);
    }
}


// --- Main Puppeteer Logic (as an async function) ---
// Now accepts a specific dateString to simulate for
async function runStockMockSimulation(phoneNumber, password, dateString, browserclose, terminate, page, browser) {
    //let browser;
    let simulationResult = ''; // Changed name to avoid conflict with loop's aggregate result
    let pnl2 = null;
    let pnl230 = null;
    let pnl3 = null;
    let maxPnl = Number.MIN_SAFE_INTEGER;
    let minPnl = Number.MAX_SAFE_INTEGER;
    let callLTP_917 = null;
    let putLTP_917 = null;
    let straddlepremium = null;

    try {
        
        if(browser){console.log("yes browser hey")}
        if(page){console.log("yes page")}
    
        monitorConnectionIssue(page, async () => {
            console.log("♻️ Detected connection issue — trying to recover...");
            pauseMonitoringFor(30000);
            simulationResult = "Connection issue detected. Please try again.";
            throw new Error("Connection issue during simulation.");
        });

        monitorLoadingStuck(page, async () => {
            console.log("♻️ Detected stuck loading state — trying to refresh...");
            pauseMonitoringFor(30000);
            simulationResult = "Loading stuck. Please try again.";
            throw new Error("Loading stuck during simulation.");
        });

        async function loginFunctionInternal(page, browser, pn, pw) {
            console.log("before goto login")
            await page.goto('https://www.stockmock.in/#!/login', { waitUntil: 'networkidle2' });
            await new Promise(resolve => setTimeout(resolve, 5000));
            console.log("after login goto")

            let type_phone_number_success = await safeType(page, '#user-phone-no', pn, 'Phone Number');
            if (!type_phone_number_success) {
                console.log("Failed typing phone number. Retrying login...");
                await new Promise(resolve => setTimeout(resolve, 2000));
                return loginFunctionInternal(page, browser, pn, pw);
            }

            let type_password_success = await safeType(page, '#root > div.__page.dashboard > div > div:nth-child(1) > div:nth-child(2) > form > div:nth-child(4) > div > input', pw, 'Password');
            if (!type_password_success) {
                console.log("Failed typing password. Retrying login...");
                await new Promise(resolve => setTimeout(resolve, 2000));
                return loginFunctionInternal(page, browser, pn, pw);
            }

            let login_btn_click_success = await safeClick(page, '#root > div.__page.dashboard > div > div:nth-child(1) > div:nth-child(2) > form > div.__button__control > button', 'Login Button');
            if (!login_btn_click_success) {
                console.log("Failed clicking login button. Retrying login...");
                await new Promise(resolve => setTimeout(resolve, 2000));
                return loginFunctionInternal(page, browser, pn, pw);
            }

            console.log('Logging in...');
            await new Promise(resolve => setTimeout(resolve, 5000));

            const context = browser.defaultBrowserContext();
            const cookieslogin = await context.cookies();
            fs.writeFileSync('cookies.json', JSON.stringify(cookieslogin, null, 2));
            console.log('Cookies saved.');
            return true;
        }

        if(browserclose==1){
        const loginSuccess = await loginFunctionInternal(page, browser, phoneNumber, password);
        if (!loginSuccess) {
            simulationResult = "Login failed. Please check credentials or try again.";
            return simulationResult;
        }
        }
        
        

        // --- Start Simulation for a specific date ---
        await new Promise(resolve => setTimeout(resolve, 5000));
        try {
            const cookies = JSON.parse(fs.readFileSync('cookies.json', 'utf8'));
            await page.setCookie(...cookies);
            console.log('Cookies loaded and set.');
        } catch (error) {
            console.warn('Could not load cookies, proceeding without them:', error.message);
        }

        await page.goto('https://www.stockmock.in/#!/simulator', { waitUntil: 'networkidle2' });
        await new Promise(resolve => setTimeout(resolve, 5000));

        await page.waitForSelector('#root > div.__page.simulator_page > div > div > div.simulator__result__box > div.row.simulator_content > div.simulator_box.simulator_result_box > div > div.pre_build_strategy > div.row.pre_build_strategy_box_container > div:nth-child(1) > div', { timeout: 20000 });
        console.log("Simulator page loaded.");

        // SELECT THE DATE FOR THE SIMULATION
        const dateSelectedSuccessfully = await selectSpecificDate(page, dateString);
        if (!dateSelectedSuccessfully) {
            // This date was disabled or could not be selected.
            simulationResult = `Skipped simulation for ${dateString}: Date was disabled or could not be selected.`;
            return simulationResult; // Return early for this specific date
        }
        await new Promise(resolve => setTimeout(resolve, 3000)); // Allow page to refresh after date selection

        // Begin simulation steps for the selected date
        /** Write you own Trading Logic here and ask the bot to perform actions using commands like:
                1) page.click("selector of an element you want to click')
                2) page.type("selector of am element where you want to type","text you want to type")
                3) page.reload

        I cannot disclose the strategy of the Trader for whom I build this Auto Simulation Agent, so you can try out a strategy of your own
        **/

        /** 
        You can use webhook here to send your simulation result to N8N.
        **/

    } catch (error) {
        console.error(`An error occurred during Puppeteer execution for ${dateString}:`, error);
        return `An error occurred for ${dateString}: ${error.message}\n\n`;
    } finally {
        // Crucial: Close the browser only if it was successfully launched
        // and if this is the end of an individual simulation run.
        // For a range, we want to keep the browser open between dates if possible for efficiency.
        // However, given the nature of StockMock (refreshing pages, potential re-login needs),
        // it might be safer to close and reopen the browser per date simulation,
        // or carefully manage page navigation. For simplicity and robustness here,
        // we'll keep the browser launch/close within the top-level API call that loops dates.
        if (browser) {
            if(browserclose==terminate){
                if (page) {
                    cleanupMonitors(page);
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    await clearAllCookies(page);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    await browser.close();
                }
            }
            console.log(`Browser closed for ${dateString}.`);
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
}

// --- API Endpoint ---
app.post('/run-puppeteer', async (req, res) => {
    const { phoneNumber, password, startDate, endDate } = req.body;
    var browserclose=0;
    var page;
    var browser;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*'); // Crucial for CORS if frontend is on different domain/port


    if (!phoneNumber || !password || !startDate || !endDate) {
        // Send a specific error event and close the connection
        res.write('event: error\n');
        res.write('data: ' + JSON.stringify({ message: 'Phone number, password, start date, and end date are required.' }) + '\n\n');
        return res.end();
    }

    const allDates = getDatesInRange(startDate, endDate);
    if (allDates.length === 0) {
        // Send a specific error event and close the connection
        res.write('event: error\n');
        res.write('data: ' + JSON.stringify({ message: 'No valid dates found in the specified range or invalid date format.', details: `Start: ${startDate}, End: ${endDate}` }) + '\n\n');
        return res.end();
    }

    // Indicate that processing has started
    res.write('event: start\n');
    res.write('data: ' + JSON.stringify({ message: `Starting simulation for ${allDates.length} dates.` }) + '\n\n');

    for (const dateString of allDates) {
        console.log(`Attempting simulation for date: ${dateString}`);
        let resultForDate = '';
        browserclose+=1;
        if(browserclose==1){
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-video-decode',
                '--disable-gpu',
                '--window-size=1920,1080'
            ],
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium'
        });

        if(browser){console.log("yes browser")}
        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/114.0.0.0 Safari/537.36');
        }
        try {
            resultForDate = await runStockMockSimulation(phoneNumber, password, dateString, browserclose, allDates.length, page, browser);
            res.write('event: update\n');
            res.write('data: ' + JSON.stringify({ date: dateString, status: 'success', result: resultForDate }) + '\n\n');
        } catch (error) {
            console.error(`Error during simulation for ${dateString}:`, error.message);
            resultForDate = `--- Failed simulation for ${dateString}: ${error.message} ---`; // Shorten for display
            // Send error result for this date
            res.write('event: update\n');
            res.write('data: ' + JSON.stringify({ date: dateString, status: 'error', result: resultForDate }) + '\n\n');
        }

        if (browserclose < allDates.length) { 
            console.log(`Pausing for 5 seconds before next date's simulation...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }

    res.write('event: complete\n');
    res.write('data: ' + JSON.stringify({ message: 'All simulations completed.' }) + '\n\n');
    res.end(); // Close the SSE connection
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
