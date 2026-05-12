const webAppUrl = "INSERT_SECRET_URL_HERE";

/**
 * Get authenticated URL for API requests
 * Uses no-cors mode to avoid CORS issues with Google Apps Script
 */
function getAuthUrl(action = "") {
    if (!webAppUrl || webAppUrl.includes("INSERT_SECRET")) return null;
    
    try {
        const url = new URL(webAppUrl);
        if (action) url.searchParams.append("action", action);
        return url.toString();
    } catch (e) {
        console.error('Invalid WebApp URL:', e);
        return null;
    }
}

/**
 * Get auth token for API requests
 * The token is appended as query parameter for all requests
 */
let authToken = null;

async function getAuthToken() {
    if (!authToken) {
        // Get token from session storage or fetch it
        authToken = sessionStorage.getItem('auth_token');
        if (!authToken) {
            // In production, this would be injected during build
            authToken = 'Physics-Secret-2026'; // Will be replaced during deployment
            sessionStorage.setItem('auth_token', authToken);
        }
    }
    return authToken;
}

/**
 * Make API request to Google Apps Script
 * Uses redirect mode and token in URL to avoid CORS preflight
 */
async function makeApiRequest(action, params = {}, method = 'GET', body = null) {
    const baseUrl = getAuthUrl(action);
    if (!baseUrl) {
        throw new Error("Configuration error: WebApp URL not set");
    }
    
    const token = await getAuthToken();
    const url = new URL(baseUrl);
    url.searchParams.append("token", token);
    
    // Add all params to URL for GET requests
    if (method === 'GET') {
        Object.keys(params).forEach(key => {
            url.searchParams.append(key, params[key]);
        });
    }
    
    const fetchOptions = {
        method: method,
        // Use 'cors' mode but with redirect to handle Google Apps Script
        mode: 'cors',
        redirect: 'follow',
    };
    
    // Add headers and body for POST requests
    if (method === 'POST') {
        fetchOptions.headers = {
            'Content-Type': 'text/plain', // Use text/plain to avoid preflight
            'Authorization': token
        };
        if (body) {
            fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
        }
    }
    
    try {
        const response = await fetch(url.toString(), fetchOptions);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const text = await response.text();
        try {
            return JSON.parse(text);
        } catch (e) {
            // If not JSON, return text wrapped in object
            return { result: text };
        }
    } catch (error) {
        console.error('API request failed:', error);
        throw error;
    }
}

let currentGroupMembers = [];
let currentUser = "";
let currentActivity = "";
let pendingResults = [];
let rubricData = {};
let isSubmitting = false;

/**
 * Initialize the application
 */
window.onload = async function() {
    // Clear any existing auth token to ensure fresh start
    sessionStorage.removeItem('auth_token');
    
    const fetchUrl = getAuthUrl("getInitialData");
    if (!fetchUrl) {
        document.getElementById('loading-error').innerText = 
            "Configuration Error: Application not properly configured. Please contact administrator.";
        return;
    }
    
    try {
        const data = await makeApiRequest("getInitialData");
        
        if (data.error) {
            document.getElementById('loading-error').innerText = 
                "Database Error: " + data.error;
            return;
        }
        
        processRubric(data.rubric);
        populateInitialDropdowns(data);
        switchView('step-login');
    } catch (error) {
        console.error('Initialization error:', error);
        document.getElementById('loading-error').innerText = 
            "Connection failed. Please check your internet connection and try again.";
    }
};

/**
 * Process rubric data into structured format
 */
function processRubric(raw) {
    rubricData = {};
    if (!Array.isArray(raw)) return;
    
    raw.forEach(row => {
        if (!row[0] || !row[1]) return; // Skip invalid rows
        
        const criteria = String(row[0]);
        const level = String(row[1]);
        const title = String(row[2] || '');
        const desc = String(row[3] || '');
        
        if (!rubricData[criteria]) {
            rubricData[criteria] = [];
        }
        rubricData[criteria].push({ level, title, desc });
    });
}

/**
 * Populate dropdown selects with initial data
 */
function populateInitialDropdowns(data) {
    if (!data) return;
    
    const sectionSelect = document.getElementById('section-select');
    if (sectionSelect && data.sections) {
        sectionSelect.innerHTML = '<option value="">-- Select Section --</option>';
        data.sections.forEach(sec => {
            const opt = document.createElement('option');
            opt.value = sec;
            opt.textContent = sec;
            sectionSelect.appendChild(opt);
        });
    }
    
    const groupSelect = document.getElementById('group-select');
    if (groupSelect && data.groups) {
        groupSelect.innerHTML = '<option value="">-- Select Group --</option>';
        data.groups.forEach(grp => {
            const opt = document.createElement('option');
            opt.value = grp;
            opt.textContent = "Group " + grp;
            groupSelect.appendChild(opt);
        });
    }
    
    const activitySelect = document.getElementById('activity-select');
    if (activitySelect && data.activities) {
        activitySelect.innerHTML = '<option value="">-- Select Activity --</option>';
        data.activities.forEach(act => {
            const opt = document.createElement('option');
            opt.value = act;
            opt.textContent = act;
            activitySelect.appendChild(opt);
        });
    }
}

/**
 * Attempt login with provided credentials
 */
async function attemptLogin() {
    const section = document.getElementById('section-select').value;
    const group = document.getElementById('group-select').value;
    const keyInput = document.getElementById('group-key').value;
    
    // Clear previous errors
    document.getElementById('login-error').innerText = '';
    
    if (!section || !group || !keyInput) {
        document.getElementById('login-error').innerText = "Please fill in all fields.";
        return;
    }
    
    const loginBtn = document.querySelector('#step-login button');
    loginBtn.textContent = "Authenticating...";
    loginBtn.disabled = true;
    
    try {
        const data = await makeApiRequest("login", {
            section: section,
            group: group,
            key: keyInput
        });
        
        if (!data.valid) {
            document.getElementById('login-error').innerText = 
                data.error || "Incorrect key or credentials.";
            loginBtn.textContent = "Login";
            loginBtn.disabled = false;
            return;
        }
        
        if (!data.students || data.students.length === 0) {
            document.getElementById('login-error').innerText = 
                "No students found in this section and group.";
            loginBtn.textContent = "Login";
            loginBtn.disabled = false;
            return;
        }
        
        currentGroupMembers = data.students;
        
        // Populate student select
        const studentSelect = document.getElementById('student-select');
        studentSelect.innerHTML = '<option value="">-- Select your name --</option>';
        currentGroupMembers.forEach(student => {
            const opt = document.createElement('option');
            opt.value = student['Student Name'];
            opt.textContent = student['Student Name'];
            studentSelect.appendChild(opt);
        });
        
        // Clear sensitive data
        document.getElementById('group-key').value = '';
        
        switchView('step-setup');
        loginBtn.textContent = "Login";
        loginBtn.disabled = false;
        
    } catch (error) {
        console.error('Login error:', error);
        document.getElementById('login-error').innerText = 
            "Network error. Please check your connection and try again.";
        loginBtn.textContent = "Login";
        loginBtn.disabled = false;
    }
}

/**
 * Start evaluation for selected student and activity
 */
async function startEvaluation() {
    currentUser = document.getElementById('student-select').value;
    currentActivity = document.getElementById('activity-select').value;
    
    document.getElementById('setup-error').innerText = '';
    
    if (!currentUser || !currentActivity) {
        document.getElementById('setup-error').innerText = 
            "Please select your name and an activity.";
        return;
    }
    
    const startBtn = document.querySelector('#step-setup button');
    startBtn.textContent = "Checking records...";
    startBtn.disabled = true;
    
    try {
        const data = await makeApiRequest("checkEvaluation", {
            evaluator: currentUser,
            activity: currentActivity
        });
        
        if (data.hasEvaluated) {
            document.getElementById('setup-error').innerText = 
                "You have already submitted an evaluation for this activity. " +
                "You cannot evaluate the same activity twice.";
            startBtn.textContent = "Start Evaluation";
            startBtn.disabled = false;
            return;
        }
        
        buildEvaluationForm();
        switchView('step-eval');
        startBtn.textContent = "Start Evaluation";
        startBtn.disabled = false;
        
    } catch (error) {
        console.error('Start evaluation error:', error);
        document.getElementById('setup-error').innerText = 
            "Network error. Please try again.";
        startBtn.textContent = "Start Evaluation";
        startBtn.disabled = false;
    }
}

/**
 * Build the evaluation form with all criteria
 */
function buildEvaluationForm() {
    document.getElementById('eval-subtitle').textContent = 
        `Evaluating peers for ${currentActivity}`;
    
    const container = document.getElementById('eval-form-container');
    container.innerHTML = '';
    
    // Filter out the current user from evaluation targets
    const peers = currentGroupMembers.filter(s => 
        s['Student Name'] !== currentUser
    );
    
    if (peers.length === 0) {
        container.innerHTML = '<p>No peers to evaluate in this group.</p>';
        return;
    }
    
    const criteriaNames = Object.keys(rubricData);
    
    if (criteriaNames.length === 0) {
        container.innerHTML = '<p>No evaluation criteria loaded. Please refresh the page.</p>';
        return;
    }
    
    peers.forEach((peer, index) => {
        const peerDiv = document.createElement('div');
        peerDiv.className = 'member-eval';
        peerDiv.id = `peer-card-${index}`;
        
        let peerHTML = `
            <div class="card-bg-anim"></div>
            <div class="card-bg-mask"></div>
            <h3>Evaluate: ${peer['Student Name']}</h3>`;
        
        criteriaNames.forEach((criteria, cIndex) => {
            let criteriaHtml = `
                <div class="criteria-row">
                    <div class="criteria-title">${criteria}</div>
                    <div class="radio-group">`;
            
            rubricData[criteria].forEach((levelObj) => {
                criteriaHtml += `
                    <label class="radio-label">
                        <input type="radio" 
                               name="peer${index}_crit${cIndex}" 
                               value="${levelObj.level}" 
                               onchange="checkCompletion(${index})"
                               aria-label="Level ${levelObj.level}: ${levelObj.title}">
                        <div class="bg-anim"></div>
                        <div class="bg-mask"></div>
                        <div class="content-wrapper">
                            <span class="level-title">Level ${levelObj.level}: ${levelObj.title}</span>
                            <span class="level-desc">${levelObj.desc}</span>
                        </div>
                    </label>`;
            });
            
            criteriaHtml += `</div></div>`;
            peerHTML += criteriaHtml;
        });
        
        peerDiv.innerHTML = peerHTML;
        container.appendChild(peerDiv);
    });
}

/**
 * Check if all criteria are completed for a peer
 */
function checkCompletion(peerIndex) {
    const card = document.getElementById(`peer-card-${peerIndex}`);
    if (!card || !rubricData) return;
    
    const criteriaCount = Object.keys(rubricData).length;
    const checkedCount = card.querySelectorAll('input[type="radio"]:checked').length;
    
    if (checkedCount === criteriaCount) {
        card.classList.add('completed');
    } else {
        card.classList.remove('completed');
    }
}

/**
 * Validate and prepare evaluation submission
 */
function submitEvaluation() {
    document.getElementById('eval-error').innerText = '';
    
    if (isSubmitting) return;
    
    const peers = currentGroupMembers.filter(s => 
        s['Student Name'] !== currentUser
    );
    
    if (peers.length === 0) {
        document.getElementById('eval-error').innerText = "No peers to evaluate.";
        return;
    }
    
    const criteriaNames = Object.keys(rubricData);
    const results = [];
    let hasErrors = false;
    let errorMessages = [];
    
    for (let i = 0; i < peers.length; i++) {
        const peerResult = {
            evaluator: currentUser,
            evaluatee: peers[i]['Student Name'],
            activity: currentActivity,
            scores: {}
        };
        
        for (let c = 0; c < criteriaNames.length; c++) {
            const checkedRadio = document.querySelector(
                `input[name="peer${i}_crit${c}"]:checked`
            );
            
            if (!checkedRadio) {
                errorMessages.push(`Please rate all criteria for ${peers[i]['Student Name']}`);
                hasErrors = true;
                break;
            }
            peerResult.scores[criteriaNames[c]] = checkedRadio.value;
        }
        
        if (hasErrors) break;
        results.push(peerResult);
    }
    
    if (hasErrors) {
        document.getElementById('eval-error').innerText = errorMessages.join(', ');
        return;
    }
    
    // Prepare summary for confirmation
    pendingResults = results;
    const summaryContainer = document.getElementById('confirm-summary');
    summaryContainer.innerHTML = '';
    
    results.forEach(res => {
        const total = Object.values(res.scores).reduce(
            (sum, val) => sum + Number(val), 0
        );
        const item = document.createElement('div');
        item.className = 'summary-item';
        item.innerHTML = `<strong>${res.evaluatee}</strong>: ${total} points`;
        summaryContainer.appendChild(item);
    });
    
    switchView('step-confirm');
}

/**
 * Execute final submission to server
 */
async function executeSubmit() {
    if (isSubmitting) return;
    isSubmitting = true;
    
    const finalBtn = document.getElementById('final-submit-btn');
    finalBtn.textContent = "Saving...";
    finalBtn.disabled = true;
    
    try {
        const data = await makeApiRequest("", {}, 'POST', pendingResults);
        
        if (data.error) {
            throw new Error(data.error);
        }
        
        // Success - clear sensitive data
        pendingResults = [];
        
        switchView('step-done');
        
    } catch (error) {
        console.error('Submission error:', error);
        alert("Failed to submit: " + (error.message || "Network error. Please try again."));
        finalBtn.textContent = "I Confirm";
        finalBtn.disabled = false;
    } finally {
        isSubmitting = false;
    }
}

/**
 * Switch between application views
 */
function switchView(viewId) {
    document.querySelectorAll('.card').forEach(card => {
        card.classList.remove('active-step');
    });
    
    const targetView = document.getElementById(viewId);
    if (targetView) {
        targetView.classList.add('active-step');
        // Scroll to top of view
        targetView.scrollIntoView({ behavior: 'smooth' });
    }
}

// Expose functions to global scope for HTML onclick handlers
window.attemptLogin = attemptLogin;
window.startEvaluation = startEvaluation;
window.submitEvaluation = submitEvaluation;
window.executeSubmit = executeSubmit;
window.checkCompletion = checkCompletion;
window.switchView = switchView;
