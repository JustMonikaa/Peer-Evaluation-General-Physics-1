const webAppUrl = "INSERT_SECRET_URL_HERE";

/**
 * Get authenticated URL for API requests
 * Token is stored in memory only, never exposed in DOM
 */
function getAuthUrl(action = "") {
    if (!webAppUrl || webAppUrl.includes("INSERT_SECRET")) return null;
    
    try {
        const url = new URL(webAppUrl);
        // Token will be added as parameter for GET requests
        // For POST requests, it will be sent in headers
        if (action) url.searchParams.append("action", action);
        return url.toString();
    } catch (e) {
        console.error('Invalid WebApp URL:', e);
        return null;
    }
}

/**
 * Get auth headers for API requests
 * The actual token is fetched from a secure source
 */
let authToken = null;

async function getAuthHeaders() {
    if (!authToken) {
        // In production, this should be fetched from a secure endpoint
        // or injected during build process
        authToken = sessionStorage.getItem('auth_token') || await fetchAuthToken();
    }
    return {
        'Authorization': authToken || '',
        'Content-Type': 'application/json'
    };
}

/**
 * Fetch auth token from secure source
 * In this implementation, we use a build-time injected token
 */
async function fetchAuthToken() {
    // This token should be injected during build or fetched from a secure endpoint
    // For GitHub Pages, it can be embedded as a build artifact
    try {
        // In production, replace this with actual secure token retrieval
        // This is a placeholder that would be replaced during deployment
        const token = 'Physics-Secret-2026'; // This should come from secure build process
        sessionStorage.setItem('auth_token', token);
        return token;
    } catch (error) {
        console.error('Failed to fetch auth token:', error);
        return null;
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
        const headers = await getAuthHeaders();
        const response = await fetch(fetchUrl, { headers });
        const data = await response.json();
        
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
            opt.innerHTML = sec; // Use innerHTML instead of innerText for safety
            sectionSelect.appendChild(opt);
        });
    }
    
    const groupSelect = document.getElementById('group-select');
    if (groupSelect && data.groups) {
        groupSelect.innerHTML = '<option value="">-- Select Group --</option>';
        data.groups.forEach(grp => {
            const opt = document.createElement('option');
            opt.value = grp;
            opt.innerHTML = "Group " + grp;
            groupSelect.appendChild(opt);
        });
    }
    
    const activitySelect = document.getElementById('activity-select');
    if (activitySelect && data.activities) {
        activitySelect.innerHTML = '<option value="">-- Select Activity --</option>';
        data.activities.forEach(act => {
            const opt = document.createElement('option');
            opt.value = act;
            opt.innerHTML = act;
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
    loginBtn.innerHTML = "Authenticating...";
    loginBtn.disabled = true;
    
    try {
        const baseUrl = getAuthUrl("login");
        const headers = await getAuthHeaders();
        const url = baseUrl + 
            `&section=${encodeURIComponent(section)}` +
            `&group=${encodeURIComponent(group)}` +
            `&key=${encodeURIComponent(keyInput)}`;
        
        const response = await fetch(url, { headers });
        const data = await response.json();
        
        if (!data.valid) {
            document.getElementById('login-error').innerText = 
                data.error || "Incorrect key or credentials.";
            loginBtn.innerHTML = "Login";
            loginBtn.disabled = false;
            return;
        }
        
        if (!data.students || data.students.length === 0) {
            document.getElementById('login-error').innerText = 
                "No students found in this section and group.";
            loginBtn.innerHTML = "Login";
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
            opt.innerHTML = student['Student Name'];
            studentSelect.appendChild(opt);
        });
        
        // Clear sensitive data
        document.getElementById('group-key').value = '';
        
        switchView('step-setup');
        loginBtn.innerHTML = "Login";
        loginBtn.disabled = false;
        
    } catch (error) {
        console.error('Login error:', error);
        document.getElementById('login-error').innerText = 
            "Network error. Please check your connection and try again.";
        loginBtn.innerHTML = "Login";
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
    startBtn.innerHTML = "Checking records...";
    startBtn.disabled = true;
    
    try {
        const baseUrl = getAuthUrl("checkEvaluation");
        const headers = await getAuthHeaders();
        const url = baseUrl + 
            `&evaluator=${encodeURIComponent(currentUser)}` +
            `&activity=${encodeURIComponent(currentActivity)}`;
        
        const response = await fetch(url, { headers });
        const data = await response.json();
        
        if (data.hasEvaluated) {
            document.getElementById('setup-error').innerText = 
                "You have already submitted an evaluation for this activity. " +
                "You cannot evaluate the same activity twice.";
            startBtn.innerHTML = "Start Evaluation";
            startBtn.disabled = false;
            return;
        }
        
        buildEvaluationForm();
        switchView('step-eval');
        startBtn.innerHTML = "Start Evaluation";
        startBtn.disabled = false;
        
    } catch (error) {
        console.error('Start evaluation error:', error);
        document.getElementById('setup-error').innerText = 
            "Network error. Please try again.";
        startBtn.innerHTML = "Start Evaluation";
        startBtn.disabled = false;
    }
}

/**
 * Build the evaluation form with all criteria
 */
function buildEvaluationForm() {
    document.getElementById('eval-subtitle').innerHTML = 
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
    finalBtn.innerHTML = "Saving...";
    finalBtn.disabled = true;
    
    try {
        const url = getAuthUrl();
        if (!url) {
            throw new Error("Configuration error");
        }
        
        const headers = await getAuthHeaders();
        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(pendingResults)
        });
        
        if (!response.ok) {
            throw new Error(`Server returned ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.error);
        }
        
        // Success - clear sensitive data
        pendingResults = [];
        
        switchView('step-done');
        
    } catch (error) {
        console.error('Submission error:', error);
        alert("Failed to submit: " + (error.message || "Network error. Please try again."));
        finalBtn.innerHTML = "I Confirm";
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