const webAppUrl = "INSERT_SECRET_URL_HERE";
const AUTH_TOKEN = "AUTH_TOKEN_PLACEHOLDER";

/**
 * Get auth token
 */
function getAuthToken() {
    return AUTH_TOKEN;
}

/**
 * Make API request - all requests use GET with parameters
 * to avoid CORS preflight issues
 */
async function makeApiCall(action, params = {}, postData = null) {
    if (!webAppUrl || webAppUrl.includes("INSERT_SECRET")) {
        throw new Error("Configuration error: WebApp URL not set");
    }
    
    const url = new URL(webAppUrl);
    url.searchParams.append("token", getAuthToken());
    
    if (action) {
        url.searchParams.append("action", action);
    }
    
    // Add all params to URL
    Object.keys(params).forEach(key => {
        url.searchParams.append(key, params[key]);
    });
    
    // If we have POST data, send it as form data
    if (postData) {
        const formBody = 'data=' + encodeURIComponent(JSON.stringify(postData));
        const response = await fetch(url.toString(), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: formBody
        });
        const text = await response.text();
        try {
            return JSON.parse(text);
        } catch (e) {
            return { result: text };
        }
    } else {
        // Simple GET request
        const response = await fetch(url.toString());
        const text = await response.text();
        try {
            return JSON.parse(text);
        } catch (e) {
            return { result: text };
        }
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
    if (!webAppUrl || webAppUrl.includes("INSERT_SECRET")) {
        document.getElementById('loading-error').innerText = 
            "Configuration Error: Application not properly configured.";
        return;
    }
    
    try {
        const data = await makeApiCall("getInitialData");
        
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
            "Connection failed. Please try again.";
    }
};

/**
 * Process rubric data into structured format
 */
function processRubric(raw) {
    rubricData = {};
    if (!Array.isArray(raw)) return;
    
    raw.forEach(row => {
        if (!row[0] || !row[1]) return;
        
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
 * Populate dropdown selects
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
 * Attempt login
 */
async function attemptLogin() {
    const section = document.getElementById('section-select').value;
    const group = document.getElementById('group-select').value;
    const keyInput = document.getElementById('group-key').value;
    
    document.getElementById('login-error').innerText = '';
    
    if (!section || !group || !keyInput) {
        document.getElementById('login-error').innerText = "Please fill in all fields.";
        return;
    }
    
    const loginBtn = document.querySelector('#step-login button');
    loginBtn.textContent = "Authenticating...";
    loginBtn.disabled = true;
    
    try {
        const data = await makeApiCall("login", {
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
        
        const studentSelect = document.getElementById('student-select');
        studentSelect.innerHTML = '<option value="">-- Select your name --</option>';
        currentGroupMembers.forEach(student => {
            const opt = document.createElement('option');
            opt.value = student['Student Name'];
            opt.textContent = student['Student Name'];
            studentSelect.appendChild(opt);
        });
        
        document.getElementById('group-key').value = '';
        switchView('step-setup');
        loginBtn.textContent = "Login";
        loginBtn.disabled = false;
        
    } catch (error) {
        console.error('Login error:', error);
        document.getElementById('login-error').innerText = "Network error. Please try again.";
        loginBtn.textContent = "Login";
        loginBtn.disabled = false;
    }
}

/**
 * Start evaluation
 */
async function startEvaluation() {
    currentUser = document.getElementById('student-select').value;
    currentActivity = document.getElementById('activity-select').value;
    
    document.getElementById('setup-error').innerText = '';
    
    if (!currentUser || !currentActivity) {
        document.getElementById('setup-error').innerText = "Please select your name and an activity.";
        return;
    }
    
    const startBtn = document.querySelector('#step-setup button');
    startBtn.textContent = "Checking records...";
    startBtn.disabled = true;
    
    try {
        const data = await makeApiCall("checkEvaluation", {
            evaluator: currentUser,
            activity: currentActivity
        });
        
        if (data.hasEvaluated) {
            document.getElementById('setup-error').innerText = 
                "You have already submitted an evaluation for this activity.";
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
        document.getElementById('setup-error').innerText = "Network error. Please try again.";
        startBtn.textContent = "Start Evaluation";
        startBtn.disabled = false;
    }
}

/**
 * Build evaluation form
 */
function buildEvaluationForm() {
    document.getElementById('eval-subtitle').textContent = 
        `Evaluating peers for ${currentActivity}`;
    
    const container = document.getElementById('eval-form-container');
    container.innerHTML = '';
    
    const peers = currentGroupMembers.filter(s => 
        s['Student Name'] !== currentUser
    );
    
    if (peers.length === 0) {
        container.innerHTML = '<p>No peers to evaluate in this group.</p>';
        return;
    }
    
    const criteriaNames = Object.keys(rubricData);
    
    if (criteriaNames.length === 0) {
        container.innerHTML = '<p>No evaluation criteria loaded. Please refresh.</p>';
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
 * Check completion
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
 * Submit evaluation
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
                document.getElementById('eval-error').innerText = 
                    `Please rate all criteria for ${peers[i]['Student Name']}`;
                return;
            }
            peerResult.scores[criteriaNames[c]] = checkedRadio.value;
        }
        
        results.push(peerResult);
    }
    
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
 * Execute final submission
 */
async function executeSubmit() {
    if (isSubmitting) return;
    isSubmitting = true;
    
    const finalBtn = document.getElementById('final-submit-btn');
    finalBtn.textContent = "Saving...";
    finalBtn.disabled = true;
    
    try {
        const url = new URL(webAppUrl);
        url.searchParams.append("token", getAuthToken());
        
        const formBody = 'data=' + encodeURIComponent(JSON.stringify(pendingResults));
        
        const response = await fetch(url.toString(), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: formBody
        });
        
        const text = await response.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            throw new Error("Invalid server response");
        }
        
        if (data.error) {
            throw new Error(data.error);
        }
        
        if (data.success) {
            pendingResults = [];
            switchView('step-done');
        } else {
            throw new Error("Submission failed");
        }
        
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
 * Switch views
 */
function switchView(viewId) {
    document.querySelectorAll('.card').forEach(card => {
        card.classList.remove('active-step');
    });
    
    const targetView = document.getElementById(viewId);
    if (targetView) {
        targetView.classList.add('active-step');
        targetView.scrollIntoView({ behavior: 'smooth' });
    }
}

// Expose to global scope
window.attemptLogin = attemptLogin;
window.startEvaluation = startEvaluation;
window.executeSubmit = executeSubmit;
window.submitEvaluation = submitEvaluation;
window.checkCompletion = checkCompletion;
window.switchView = switchView;
