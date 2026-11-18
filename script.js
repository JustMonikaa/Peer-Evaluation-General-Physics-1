const webAppUrl = "INSERT_SECRET_URL_HERE";
const AUTH_TOKEN = "AUTH_TOKEN_PLACEHOLDER";
const FORM_VERSION = "2.0"; // Track form version for data integrity
const STORAGE_PREFIX = "peer_eval_"; // Prefix for localStorage keys

/**
 * Get auth token
 */
function getAuthToken() {
    return AUTH_TOKEN;
}

/**
 * Make API request to Google Apps Script
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
    
    Object.keys(params).forEach(key => {
        url.searchParams.append(key, params[key]);
    });
    
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
let currentSection = "";
let currentGroup = "";
let pendingResults = [];
let rubricData = {};
let isSubmitting = false;
let maxPossibleScore = 0;
let allSectionGroups = {};

// NEW: Global index to track which student card is currently visible
let currentPeerIndex = 0;

/**
 * Show loading state on a button
 */
function setButtonLoading(buttonId, isLoading) {
    const btn = document.getElementById(buttonId);
    if (!btn) return;
    
    const btnText = btn.querySelector('.btn-text');
    const spinner = btn.querySelector('.spinner-btn');
    
    if (isLoading) {
        btn.disabled = true;
        if (btnText) btnText.style.display = 'none';
        if (spinner) spinner.style.display = 'inline-block';
    } else {
        btn.disabled = false;
        if (btnText) btnText.style.display = 'inline';
        if (spinner) spinner.style.display = 'none';
    }
}

/**
 * Toggle password visibility
 */
function togglePasswordVisibility() {
    const passwordField = document.getElementById('group-key');
    const toggleBtn = document.querySelector('.toggle-password');
    
    if (passwordField.type === 'password') {
        passwordField.type = 'text';
        toggleBtn.textContent = '🙈';
        toggleBtn.setAttribute('aria-label', 'Hide password');
    } else {
        passwordField.type = 'password';
        toggleBtn.textContent = '👁️';
        toggleBtn.setAttribute('aria-label', 'Show password');
    }
}

/**
 * Save partial evaluation to localStorage
 */
function saveProgress() {
    const peers = currentGroupMembers.filter(s => 
        s['Student Name'] !== currentUser
    );
    
    const criteriaNames = Object.keys(rubricData);
    let hasAnyData = false;
    
    for (let i = 0; i < peers.length; i++) {
        for (let c = 0; c < criteriaNames.length; c++) {
            const checkedRadio = document.querySelector(
                `input[name="peer${i}_crit${c}"]:checked`
            );
            
            if (checkedRadio) {
                hasAnyData = true;
                const saveKey = STORAGE_PREFIX + currentSection + "_" + currentGroup + "_" + 
                               currentUser + "_" + currentActivity + "_" + 
                               peers[i]['Student Name'] + "_" + criteriaNames[c];
                localStorage.setItem(saveKey, checkedRadio.value);
            }
        }
    }
    
    if (!hasAnyData) {
        document.getElementById('eval-error').innerText = 
            "No ratings selected. Please rate at least one criterion before saving.";
        return;
    }
    
    const metaKey = STORAGE_PREFIX + currentSection + "_" + currentGroup + "_" + 
                    currentUser + "_" + currentActivity + "_meta";
    localStorage.setItem(metaKey, JSON.stringify({
        savedAt: new Date().toISOString(),
        section: currentSection,
        group: currentGroup,
        user: currentUser,
        activity: currentActivity
    }));
    
    showTemporaryMessage('eval-error', '✅ Progress saved successfully! You can return to this evaluation later.', 'success');
}

/**
 * Load and restore partial saved evaluation
 */
function loadPartialSave() {
    const metaKey = STORAGE_PREFIX + currentSection + "_" + currentGroup + "_" + 
                    currentUser + "_" + currentActivity + "_meta";
    const meta = localStorage.getItem(metaKey);
    
    if (meta) {
        try {
            const metaData = JSON.parse(meta);
            const savedDate = new Date(metaData.savedAt);
            const now = new Date();
            const daysDiff = (now - savedDate) / (1000 * 60 * 60 * 24);
            
            if (daysDiff <= 7) {
                return true; 
            } else {
                clearPartialSave();
                return false;
            }
        } catch (e) {
            console.error('Failed to parse saved metadata:', e);
            return false;
        }
    }
    return false;
}

/**
 * Restore partial saved evaluation to the form
 */
function restoreSavedEvaluation() {
    const peers = currentGroupMembers.filter(s => 
        s['Student Name'] !== currentUser
    );
    const criteriaNames = Object.keys(rubricData);
    let restoredCount = 0;
    
    peers.forEach((peer, peerIndex) => {
        criteriaNames.forEach((criteria, criteriaIndex) => {
            const saveKey = STORAGE_PREFIX + currentSection + "_" + currentGroup + "_" + 
                           currentUser + "_" + currentActivity + "_" + 
                           peer['Student Name'] + "_" + criteria;
            const savedValue = localStorage.getItem(saveKey);
            
            if (savedValue) {
                const radioBtn = document.querySelector(
                    `input[name="peer${peerIndex}_crit${criteriaIndex}"][value="${savedValue}"]`
                );
                if (radioBtn) {
                    radioBtn.checked = true;
                    restoredCount++;
                }
            }
        });
        
        if (restoredCount > 0) {
            checkCompletion(peerIndex);
        }
    });
    
    if (restoredCount > 0) {
        document.getElementById('saved-indicator').style.display = 'block';
    }
}

/**
 * Clear partial save (after successful submission)
 */
function clearPartialSave() {
    const metaKey = STORAGE_PREFIX + currentSection + "_" + currentGroup + "_" + 
                    currentUser + "_" + currentActivity + "_meta";
    localStorage.removeItem(metaKey);
    
    const peers = currentGroupMembers.filter(s => 
        s['Student Name'] !== currentUser
    );
    const criteriaNames = Object.keys(rubricData);
    
    peers.forEach(peer => {
        criteriaNames.forEach(criteria => {
            const saveKey = STORAGE_PREFIX + currentSection + "_" + currentGroup + "_" + 
                           currentUser + "_" + currentActivity + "_" + 
                           peer['Student Name'] + "_" + criteria;
            localStorage.removeItem(saveKey);
        });
    });
}

/**
 * Show temporary success/error message
 */
function showTemporaryMessage(elementId, message, type = 'success') {
    const element = document.getElementById(elementId);
    const originalColor = element.style.color;
    const originalBg = element.style.backgroundColor;
    const originalBorder = element.style.borderLeft;
    
    if (type === 'success') {
        element.style.color = '#155724';
        element.style.backgroundColor = '#d4edda';
        element.style.borderLeft = '4px solid #155724';
    }
    
    element.innerText = message;
    
    setTimeout(() => {
        element.style.color = originalColor;
        element.style.backgroundColor = originalBg;
        element.style.borderLeft = originalBorder;
        element.innerText = '';
    }, 3000);
}

/**
 * Initialize the application
 */
window.onload = async function() {
    if (!webAppUrl || webAppUrl.includes("INSERT_SECRET")) {
        document.getElementById('loading-error').innerText = 
            "Configuration Error: Application not properly configured.";
        document.getElementById('loading-message').style.display = 'none';
        document.querySelector('#step-loading .spinner').style.display = 'none';
        return;
    }
    
    try {
        const data = await makeApiCall("getInitialData");
        
        if (data.error) {
            document.getElementById('loading-error').innerText = 
                "Database Error: " + data.error;
            document.getElementById('loading-message').style.display = 'none';
            document.querySelector('#step-loading .spinner').style.display = 'none';
            document.getElementById('loading-retry').style.display = 'block';
            return;
        }
        
        processRubric(data.rubric);
        populateInitialDropdowns(data);
        setupSectionChangeListener();
        switchView('step-login');
    } catch (error) {
        console.error('Initialization error:', error);
        document.getElementById('loading-error').innerText = 
            "Connection failed. Please check your internet and try again.";
        document.getElementById('loading-message').style.display = 'none';
        document.querySelector('#step-loading .spinner').style.display = 'none';
        document.getElementById('loading-retry').style.display = 'block';
    }
};

/**
 * Setup listener for section changes to filter groups
 */
function setupSectionChangeListener() {
    const sectionSelect = document.getElementById('section-select');
    sectionSelect.addEventListener('change', function() {
        const selectedSection = this.value;
        const groupSelect = document.getElementById('group-select');
        
        if (!selectedSection) {
            groupSelect.innerHTML = '<option value="">-- Select Section First --</option>';
            groupSelect.disabled = true;
            return;
        }
        
        groupSelect.disabled = false;
        groupSelect.innerHTML = '<option value="">-- Select Group --</option>';
        
        const sectionGroups = allSectionGroups[selectedSection] || [];
        
        if (sectionGroups.length === 0) {
            fetchGroupsForSection(selectedSection);
            groupSelect.innerHTML = '<option value="">Loading groups...</option>';
            return;
        }
        
        const sortedGroups = sectionGroups.map(g => parseInt(g)).sort((a, b) => a - b);
        sortedGroups.forEach(grp => {
            const opt = document.createElement('option');
            opt.value = grp;
            opt.textContent = "Group " + grp;
            groupSelect.appendChild(opt);
        });
    });
}

/**
 * Fetch groups for a specific section (fallback)
 */
async function fetchGroupsForSection(section) {
    try {
        const data = await makeApiCall("getSectionGroups", { section: section });
        if (data.groups && data.groups.length > 0) {
            allSectionGroups[section] = data.groups;
            
            const groupSelect = document.getElementById('group-select');
            groupSelect.innerHTML = '<option value="">-- Select Group --</option>';
            
            const sortedGroups = data.groups.map(g => parseInt(g)).sort((a, b) => a - b);
            sortedGroups.forEach(grp => {
                const opt = document.createElement('option');
                opt.value = grp;
                opt.textContent = "Group " + grp;
                groupSelect.appendChild(opt);
            });
        } else {
            const groupSelect = document.getElementById('group-select');
            groupSelect.innerHTML = '<option value="">No groups found for this section</option>';
        }
    } catch (error) {
        console.error('Error fetching section groups:', error);
        const groupSelect = document.getElementById('group-select');
        groupSelect.innerHTML = '<option value="">Error loading groups. Please try again.</option>';
    }
}

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
    
    maxPossibleScore = 0;
    Object.keys(rubricData).forEach(criteria => {
        if (rubricData[criteria].length > 0) {
            const maxLevel = Math.max(...rubricData[criteria].map(l => parseInt(l.level) || 0));
            maxPossibleScore += maxLevel;
        }
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
    
    if (data.groupsBySection) {
        allSectionGroups = data.groupsBySection;
    } else if (data.sections && data.groups) {
        allSectionGroups = {};
        data.sections.forEach(sec => {
            allSectionGroups[sec] = data.groups || [];
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
    
    setButtonLoading('login-btn', true);
    
    try {
        const data = await makeApiCall("login", {
            section: section,
            group: group,
            key: keyInput
        });
        
        if (!data.valid) {
            document.getElementById('login-error').innerText = 
                data.error || "Incorrect key or credentials.";
            setButtonLoading('login-btn', false);
            return;
        }
        
        if (!data.students || data.students.length === 0) {
            document.getElementById('login-error').innerText = 
                "No students found in this section and group.";
            setButtonLoading('login-btn', false);
            return;
        }
        
        currentGroupMembers = data.students;
        currentSection = section;
        currentGroup = group;
        
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
        setButtonLoading('login-btn', false);
        
    } catch (error) {
        console.error('Login error:', error);
        document.getElementById('login-error').innerText = "Network error. Please check your connection and try again.";
        setButtonLoading('login-btn', false);
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
    
    setButtonLoading('start-btn', true);
    
    try {
        const data = await makeApiCall("checkEvaluation", {
            evaluator: currentUser,
            activity: currentActivity
        });
        
        if (data.hasEvaluated) {
            document.getElementById('setup-error').innerText = 
                "You have already submitted an evaluation for this activity. You cannot evaluate the same activity twice.";
            setButtonLoading('start-btn', false);
            return;
        }
        
        // Reset index for single-view and initialize UI
        currentPeerIndex = 0;
        const hasPartial = loadPartialSave();
        buildEvaluationForm();
        updatePeerNavigation();
        
        if (hasPartial) {
            setTimeout(() => {
                restoreSavedEvaluation();
            }, 100);
        }
        
        switchView('step-eval');
        setButtonLoading('start-btn', false);
        
    } catch (error) {
        console.error('Start evaluation error:', error);
        document.getElementById('setup-error').innerText = "Network error. Please check your connection and try again.";
        setButtonLoading('start-btn', false);
    }
}

/**
 * Build evaluation form
 */
function buildEvaluationForm() {
    const container = document.getElementById('eval-form-container');
    container.innerHTML = '';
    
    const peers = currentGroupMembers.filter(s => 
        s['Student Name'] !== currentUser
    );
    
    if (peers.length === 0) {
        container.innerHTML = '<p>No peers to evaluate in this group. <button onclick="switchView(\'step-setup\')" class="back-btn" style="width:auto;">← Go Back</button></p>';
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
        
        // Hide all cards except the very first one
        if (index !== 0) {
            peerDiv.classList.add('hidden-peer');
        }
        
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
 * NEW: Manage visibility of Previous/Next/Submit buttons based on the current peer
 */
function updatePeerNavigation() {
    const peers = currentGroupMembers.filter(s => s['Student Name'] !== currentUser);
    const prevBtn = document.getElementById('prev-peer-btn');
    const nextBtn = document.getElementById('next-peer-btn');
    const submitActions = document.getElementById('eval-submit-actions');
    const subtitle = document.getElementById('eval-subtitle');
    
    if (peers.length === 0) return;
    
    // Update Subtitle Progress tracker
    if (subtitle) {
        subtitle.textContent = `Evaluating peer ${currentPeerIndex + 1} of ${peers.length} for ${currentActivity}`;
    }

    if (peers.length <= 1) {
        if (prevBtn) prevBtn.style.display = 'none';
        if (nextBtn) nextBtn.style.display = 'none';
        if (submitActions) submitActions.style.display = 'flex';
        return;
    }

    if (currentPeerIndex === 0) {
        if (prevBtn) prevBtn.style.display = 'none';
        if (nextBtn) nextBtn.style.display = 'flex';
        if (submitActions) submitActions.style.display = 'none';
    } else if (currentPeerIndex === peers.length - 1) {
        if (prevBtn) prevBtn.style.display = 'flex';
        if (nextBtn) nextBtn.style.display = 'none';
        if (submitActions) submitActions.style.display = 'flex';
    } else {
        if (prevBtn) prevBtn.style.display = 'flex';
        if (nextBtn) nextBtn.style.display = 'flex';
        if (submitActions) submitActions.style.display = 'none';
    }
}

/**
 * NEW: Handle navigating forward (forces validation of current card)
 */
function nextPeer() {
    // Validate current card before allowing them to move forward
    const criteriaNames = Object.keys(rubricData);
    let isComplete = true;
    for (let c = 0; c < criteriaNames.length; c++) {
        const checkedRadio = document.querySelector(
            `input[name="peer${currentPeerIndex}_crit${c}"]:checked`
        );
        if (!checkedRadio) {
            isComplete = false;
            break;
        }
    }

    if (!isComplete) {
        document.getElementById('eval-error').innerText = "Please rate all criteria before moving to the next peer.";
        return;
    }

    document.getElementById('eval-error').innerText = "";
    document.getElementById(`peer-card-${currentPeerIndex}`).classList.add('hidden-peer');
    currentPeerIndex++;
    document.getElementById(`peer-card-${currentPeerIndex}`).classList.remove('hidden-peer');
    
    updatePeerNavigation();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * NEW: Handle navigating backward
 */
function prevPeer() {
    document.getElementById('eval-error').innerText = "";
    document.getElementById(`peer-card-${currentPeerIndex}`).classList.add('hidden-peer');
    currentPeerIndex--;
    document.getElementById(`peer-card-${currentPeerIndex}`).classList.remove('hidden-peer');
    
    updatePeerNavigation();
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
                
                // If they bypassed validation somehow, forcibly unhide the missing card and switch to it
                document.querySelectorAll('.member-eval').forEach(el => el.classList.add('hidden-peer'));
                document.getElementById(`peer-card-${i}`).classList.remove('hidden-peer');
                currentPeerIndex = i;
                updatePeerNavigation();
                document.getElementById(`peer-card-${i}`).scrollIntoView({ behavior: 'smooth' });
                return;
            }
            peerResult.scores[criteriaNames[c]] = checkedRadio.value;
        }
        
        results.push(peerResult);
    }
    
    pendingResults = results;
    buildConfirmSummary();
    switchView('step-confirm');
}

/**
 * Build confirmation summary
 */
function buildConfirmSummary() {
    const summaryContainer = document.getElementById('confirm-summary');
    summaryContainer.innerHTML = '';
    
    pendingResults.forEach(res => {
        const total = Object.values(res.scores).reduce(
            (sum, val) => sum + Number(val), 0
        );
        const percentage = maxPossibleScore > 0 ? Math.round((total / maxPossibleScore) * 100) : 0;
        const item = document.createElement('div');
        item.className = 'summary-item';
        item.innerHTML = `<strong>${res.evaluatee}</strong>: ${total} / ${maxPossibleScore} points (${percentage}%)`;
        summaryContainer.appendChild(item);
    });
}

/**
 * Execute final submission
 */
async function executeSubmit() {
    if (isSubmitting) return;
    isSubmitting = true;
    
    setButtonLoading('final-submit-btn', true);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 35000);
    
    try {
        const resultsForReceipt = [...pendingResults];
        const url = new URL(webAppUrl);
        url.searchParams.append("token", getAuthToken());
        
        const submissionData = {
            evaluations: pendingResults,
            formVersion: FORM_VERSION,
            section: currentSection,
            group: currentGroup,
            submittedAt: new Date().toISOString()
        };
        
        const formBody = 'data=' + encodeURIComponent(JSON.stringify(submissionData));
        
        const response = await fetch(url.toString(), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: formBody,
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        const text = await response.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            throw new Error("Invalid server response. Please check your Web App URL.");
        }
        
        if (!data.success) {
            alert(data.error || "System is busy with other submissions. Please try again in a moment.");
            return;
        }
        
        buildReceipt(resultsForReceipt);
        clearPartialSave();
        pendingResults = [];
        switchView('step-done');
        
    } catch (error) {
        console.error('Submission error:', error);
        let errorMsg = "Failed to submit: ";
        
        if (error.name === 'AbortError') {
            errorMsg += "The server took too long to respond. Please check your internet connection and try again.";
        } else if (error.message.includes("Rate limit")) {
            errorMsg += "Rate limit exceeded. Please wait up to 1 hour before trying again.";
        } else {
            errorMsg += (error.message || "Network error. Please check your connection and try again.");
        }
        
        alert(errorMsg);
    } finally {
        isSubmitting = false;
        setButtonLoading('final-submit-btn', false);
    }
}

/**
 * Build submission receipt
 */
function buildReceipt(resultsForReceipt) {
    const receiptDiv = document.getElementById('submission-receipt');
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
    });
    const timeStr = now.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
    
    let receiptHTML = `
        <div class="receipt-header">
            <h3>Submission Receipt</h3>
            <p>General Physics 1 - Peer Evaluation</p>
            <p><small>Form Version: ${FORM_VERSION}</small></p>
        </div>
        <div class="receipt-row">
            <span>Evaluator:</span>
            <span>${currentUser}</span>
        </div>
        <div class="receipt-row">
            <span>Section:</span>
            <span>${currentSection}</span>
        </div>
        <div class="receipt-row">
            <span>Group:</span>
            <span>${currentGroup}</span>
        </div>
        <div class="receipt-row">
            <span>Activity:</span>
            <span>${currentActivity}</span>
        </div>
        <div class="receipt-row">
            <span>Date:</span>
            <span>${dateStr}</span>
        </div>
        <div class="receipt-row">
            <span>Time:</span>
            <span>${timeStr}</span>
        </div>
        <div class="receipt-total">
            <span>Peers Evaluated:</span>
            <span>${resultsForReceipt.length}</span>
        </div>`;
    
    resultsForReceipt.forEach(res => {
        const total = Object.values(res.scores).reduce(
            (sum, val) => sum + Number(val), 0
        );
        receiptHTML += `
        <div class="receipt-row" style="margin-top: 5px;">
            <span>${res.evaluatee}:</span>
            <span>${total} / ${maxPossibleScore}</span>
        </div>`;
    });
    
    receiptDiv.innerHTML = receiptHTML;
}

/**
 * NEW: Takes a screenshot of the receipt and triggers a download
 */
async function downloadReceipt() {
    const receiptDiv = document.getElementById('submission-receipt');
    const btn = document.getElementById('download-receipt-btn');
    const originalText = btn.innerHTML;
    
    btn.innerHTML = "📸 Generating Image...";
    btn.disabled = true;

    try {
        const canvas = await html2canvas(receiptDiv, {
            scale: 2, // High resolution for mobile zooming
            backgroundColor: "#ffffff",
            logging: false,
            useCORS: true
        });
        
        const link = document.createElement('a');
        link.download = `Receipt_${currentUser.replace(/\s+/g, '_')}_${currentActivity.replace(/\s+/g, '_')}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    } catch (error) {
        console.error("Error generating receipt image:", error);
        alert("Failed to generate image. Please take a manual screenshot of your screen.");
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

/**
 * Reset for next student
 */
function resetForNextStudent() {
    currentUser = "";
    currentActivity = "";
    pendingResults = [];
    currentPeerIndex = 0;
    
    document.getElementById('student-select').innerHTML = '<option value="">-- Select your name --</option>';
    document.getElementById('activity-select').value = '';
    document.getElementById('saved-indicator').style.display = 'none';
    document.getElementById('submission-receipt').innerHTML = '';
    
    switchView('step-setup');
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
window.saveProgress = saveProgress;
window.togglePasswordVisibility = togglePasswordVisibility;
window.resetForNextStudent = resetForNextStudent;
window.nextPeer = nextPeer;
window.prevPeer = prevPeer;
window.downloadReceipt = downloadReceipt;
