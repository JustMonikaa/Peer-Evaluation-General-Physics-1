const webAppUrl = "INSERT_SECRET_URL_HERE";

/**
 * Get auth token
 */
function getAuthToken() {
    return 'Physics-Secret-2026'; // Will be replaced during deployment
}

/**
 * Make GET request (works without CORS issues)
 */
async function makeGetRequest(action, params = {}) {
    if (!webAppUrl || webAppUrl.includes("INSERT_SECRET")) {
        throw new Error("Configuration error: WebApp URL not set");
    }
    
    const url = new URL(webAppUrl);
    url.searchParams.append("token", getAuthToken());
    url.searchParams.append("action", action);
    
    Object.keys(params).forEach(key => {
        url.searchParams.append(key, params[key]);
    });
    
    // Use no-cors mode for GET requests
    const response = await fetch(url.toString(), {
        method: 'GET',
        mode: 'no-cors',
        cache: 'no-cache',
        redirect: 'follow'
    });
    
    // With no-cors, we can't read the response directly
    // We need to use a workaround
    if (response.type === 'opaque') {
        // For opaque responses, we need to make the same request using JSONP
        return await makeJsonpRequest(url.toString());
    }
    
    return await response.json();
}

/**
 * Make JSONP request for GET operations
 */
function makeJsonpRequest(url) {
    return new Promise((resolve, reject) => {
        const callbackName = 'jsonp_callback_' + Math.round(100000 * Math.random());
        const script = document.createElement('script');
        
        window[callbackName] = function(data) {
            delete window[callbackName];
            document.body.removeChild(script);
            resolve(data);
        };
        
        const jsonpUrl = url + '&callback=' + callbackName;
        script.src = jsonpUrl;
        script.onerror = function() {
            delete window[callbackName];
            document.body.removeChild(script);
            reject(new Error('JSONP request failed'));
        };
        
        document.body.appendChild(script);
    });
}

/**
 * Make POST request using form submission to avoid CORS
 */
function makePostRequest(data) {
    return new Promise((resolve, reject) => {
        const url = webAppUrl + '?token=' + encodeURIComponent(getAuthToken());
        
        // Create a hidden iframe for the form submission
        const iframe = document.createElement('iframe');
        iframe.name = 'submit_frame';
        iframe.style.display = 'none';
        document.body.appendChild(iframe);
        
        // Create a form that will submit to the iframe
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = url;
        form.target = 'submit_frame';
        form.style.display = 'none';
        
        // Add data as a hidden input
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = 'data';
        input.value = JSON.stringify(data);
        form.appendChild(input);
        
        // Handle response
        const timeout = setTimeout(() => {
            cleanup();
            reject(new Error('Request timed out'));
        }, 30000);
        
        function cleanup() {
            clearTimeout(timeout);
            document.body.removeChild(form);
            document.body.removeChild(iframe);
        }
        
        iframe.onload = function() {
            try {
                const response = iframe.contentDocument.body.textContent;
                const parsed = JSON.parse(response);
                cleanup();
                resolve(parsed);
            } catch (e) {
                cleanup();
                reject(new Error('Invalid response'));
            }
        };
        
        document.body.appendChild(form);
        form.submit();
    });
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
    const fetchUrl = getAuthUrl("getInitialData");
    if (!fetchUrl) {
        document.getElementById('loading-error').innerText = 
            "Configuration Error: Application not properly configured. Please contact administrator.";
        return;
    }
    
    try {
        const data = await makeGetRequest("getInitialData");
        
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
 * Get auth URL (legacy function for compatibility)
 */
function getAuthUrl(action = "") {
    if (!webAppUrl || webAppUrl.includes("INSERT_SECRET")) return null;
    return webAppUrl;
}

/**
 * Attempt login with provided credentials
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
        const data = await makeGetRequest("login", {
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
        const data = await makeGetRequest("checkEvaluation", {
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
 * Execute final submission using form POST to avoid CORS
 */
async function executeSubmit() {
    if (isSubmitting) return;
    isSubmitting = true;
    
    const finalBtn = document.getElementById('final-submit-btn');
    finalBtn.textContent = "Saving...";
    finalBtn.disabled = true;
    
    try {
        const data = await makePostRequest(pendingResults);
        
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
 * Switch between application views
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

// Expose functions to global scope
window.attemptLogin = attemptLogin;
window.startEvaluation = startEvaluation;
window.submitEvaluation = submitEvaluation;
window.executeSubmit = executeSubmit;
window.checkCompletion = checkCompletion;
window.switchView = switchView;
