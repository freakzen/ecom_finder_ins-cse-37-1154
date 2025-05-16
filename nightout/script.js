const GEMINI_API_KEY = "AIzaSyCpbhb7PgKZNOIZatSdFmNvY_Jfvv2vqXI"; 
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

// Global variables
// Global variables
let websitesData = [];
let filteredWebsitesData = [];
let emailsData = [];
let lastRequestTime = 0;
const REQUEST_DELAY = 2000; // 2 seconds between requests
const responseCache = {};

// DOM Elements
document.addEventListener('DOMContentLoaded', function () {
    // Fetch Websites Section
    const countrySelect = document.getElementById('country');
    const stateCityInput = document.getElementById('state-city');
    const industryInput = document.getElementById('industry');
    const countInput = document.getElementById('count');
    const countValue = document.getElementById('count-value');
    const fetchWebsitesBtn = document.getElementById('fetch-websites-btn');

    // Filter Websites Section
    const domainActiveCheckbox = document.getElementById('domain-active');
    const shopifyOnlyCheckbox = document.getElementById('shopify-only');
    const loadsWithinCheckbox = document.getElementById('loads-within');
    const excludeWebsitesFile = document.getElementById('exclude-websites-file');
    const applyFiltersBtn = document.getElementById('apply-filters-btn');

    // Fetch Email IDs Section
    const dropArea = document.getElementById('drop-area');
    const csvFileInput = document.getElementById('csv-file-input');
    const browseBtn = document.getElementById('browse-btn');
    const fileInfo = document.getElementById('file-info');
    const fetchEmailsBtn = document.getElementById('fetch-emails-btn');

    // Results Section
    const resultsBody = document.getElementById('results-body');
    const exportCsvBtn = document.getElementById('export-csv-btn');
    const totalResults = document.getElementById('total-results');
    const websitesCount = document.getElementById('websites-count');
    const emailsCount = document.getElementById('emails-count');

    // Loading Overlay
    const loadingOverlay = document.getElementById('loading-overlay');
    const progressFill = document.querySelector('.progress-fill');

    // Initialize particles.js background
    particlesJS('particles-js', {
        particles: {
            number: { value: 80, density: { enable: true, value_area: 800 } },
            color: { value: "#6c5ce7" },
            shape: { type: "circle" },
            opacity: { value: 0.5, random: true },
            size: { value: 3, random: true },
            line_linked: { enable: true, distance: 150, color: "#6c5ce7", opacity: 0.4, width: 1 },
            move: { enable: true, speed: 2, direction: "none", random: true, straight: false, out_mode: "out" }
        },
        interactivity: {
            events: {
                onclick: { enable: true, mode: "push" }
            }
        }
    });

    countInput.addEventListener('input', function () {
        countValue.textContent = this.value;
    });

    fetchWebsitesBtn.addEventListener('click', fetchWebsites);
    applyFiltersBtn.addEventListener('click', applyFilters);
    browseBtn.addEventListener('click', () => csvFileInput.click());
    csvFileInput.addEventListener('change', handleCsvFileUpload);
    fetchEmailsBtn.addEventListener('click', fetchEmailIDs);
    exportCsvBtn.addEventListener('click', exportToCsv);
    excludeWebsitesFile.addEventListener('change', handleExcludeWebsitesFileUpload);

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, preventDefaults, false);
    });

    ['dragenter', 'dragover'].forEach(eventName => {
        dropArea.addEventListener(eventName, highlight, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, unhighlight, false);
    });

    dropArea.addEventListener('drop', handleDrop, false);

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    function highlight() {
        dropArea.classList.add('active');
    }

    function unhighlight() {
        dropArea.classList.remove('active');
    }

    function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        handleFiles(files);
    }

    function handleFiles(files) {
        if (files[0].type !== 'text/csv') {
            showNotification('Please upload a CSV file.', 'error');
            return;
        }
        fileInfo.textContent = files[0].name;
        fileInfo.classList.add('show');
        csvFileInput.files = files;
    }

    async function fetchWebsites() {
        if (!validateFetchWebsitesInputs()) return;

        showLoading();

        try {
            const country = countrySelect.value;
            const stateCity = stateCityInput.value.trim();
            const industry = industryInput.value.trim();
            const count = parseInt(countInput.value) || 100;

            const prompt = `Provide exactly ${count} e-commerce websites that match these criteria:

Country: ${country}
Location: ${stateCity}
Industry: ${industry}

Return only the website URLs, one per line, with no additional text or formatting. Each URL should be complete (include https://) and valid.`;

            const response = await callGeminiAPI(prompt);
            websitesData = response.split('\n')
                .map(line => line.trim())
                .filter(line => /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(line))
                .slice(0, count);

            if (websitesData.length === 0) throw new Error("No valid websites found in the response");

            updateResultsTable(websitesData);
            updateStats();
            hideLoading();
            showNotification('Websites fetched successfully!', 'success');
        } catch (error) {
            hideLoading();
            showNotification(`Error fetching websites: ${error.message}`, 'error');
        }
    }

    function validateFetchWebsitesInputs() {
        if (!countrySelect.value) {
            showNotification('Please select a country.', 'error');
            return false;
        }
        if (!stateCityInput.value.trim()) {
            showNotification('Please enter a state or city keyword.', 'error');
            return false;
        }
        if (!industryInput.value.trim()) {
            showNotification('Please enter an industry keyword.', 'error');
            return false;
        }
        return true;
    }

    let excludeWebsites = [];

    function handleExcludeWebsitesFileUpload(event) {
        const file = event.target.files[0];
        if (!file || file.type !== 'text/csv') {
            showNotification('Please upload a CSV file.', 'error');
            return;
        }

        const reader = new FileReader();
        reader.onload = function (e) {
            excludeWebsites = parseCSV(e.target.result);
            showNotification(`Excluded ${excludeWebsites.length} websites from CSV`, 'success');
        };
        reader.readAsText(file);
    }

    function handleCsvFileUpload(event) {
        const file = event.target.files[0];
        if (!file || file.type !== 'text/csv') {
            showNotification('Please upload a CSV file.', 'error');
            return;
        }

        fileInfo.textContent = file.name;
        fileInfo.classList.add('show');
    }

    async function applyFilters() {
        if (!websitesData.length) {
            showNotification('Please fetch websites first before applying filters.', 'error');
            return;
        }

        showLoading();

        try {
            const domainActive = domainActiveCheckbox.checked;
            const shopifyOnly = shopifyOnlyCheckbox.checked;
            const loadsWithin = loadsWithinCheckbox.checked;

            let prompt = `Filter these e-commerce websites based on these criteria:\n`;
            if (domainActive) prompt += "- Only include active domains\n";
            if (shopifyOnly) prompt += "- Only include Shopify websites\n";
            if (loadsWithin) prompt += "- Only include websites that load within 5 seconds\n";
            if (excludeWebsites.length) prompt += `- Exclude these websites:\n${excludeWebsites.join('\n')}\n\n`;

            prompt += `Websites to filter:\n${websitesData.join('\n')}\n\n`;
            prompt += `Return only the filtered list of websites that meet all criteria, one per line. Include https:// in each URL.`;

            const response = await callGeminiAPI(prompt);
            filteredWebsitesData = response.split('\n')
                .map(line => line.trim())
                .filter(line => /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(line));

            updateResultsTable(filteredWebsitesData);
            updateStats();

            const filteredCsv = convertToCSV(filteredWebsitesData);
            downloadCSV(filteredCsv, 'Websites_filtered.csv');

            hideLoading();
            showNotification('Filters applied successfully! CSV downloaded.', 'success');
        } catch (error) {
            hideLoading();
            showNotification(`Error applying filters: ${error.message}`, 'error');
        }
    }

    async function fetchEmailIDs() {
        const file = csvFileInput.files[0];
        if (!file) {
            showNotification('Please upload a CSV file first.', 'error');
            return;
        }

        showLoading();

        try {
            const websites = await readCSVFile(file);
            const prompt = `For these e-commerce websites, find the most likely contact email addresses:

${websites.join('\n')}

Return only the email addresses, one per line, with no additional text. Only include valid email addresses.`;

            const response = await callGeminiAPI(prompt);
            emailsData = response.split('\n')
                .map(line => line.trim())
                .filter(line => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(line));

            updateResultsTable(emailsData);
            updateStats();
            hideLoading();
            showNotification(`${emailsData.length} emails extracted successfully!`, 'success');
        } catch (error) {
            hideLoading();
            showNotification(`Error fetching email IDs: ${error.message}`, 'error');
        }
    }

    function updateResultsTable(data) {
        resultsBody.innerHTML = '';

        if (data.length === 0) {
            resultsBody.innerHTML = `
                <tr class="empty-row">
                    <td colspan="3">
                        <div class="empty-state">
                            <i class="fas fa-database"></i>
                            <p>No results found</p>
                        </div>
                    </td>
                </tr>`;
            return;
        }

        data.forEach(item => {
            const row = document.createElement('tr');

            const linkCell = document.createElement('td');
            const link = document.createElement('a');
            if (item.includes('@')) {
                link.href = `mailto:${item}`;
            } else {
                link.href = item;
                link.target = '_blank';
            }
            link.textContent = item;
            link.classList.add('result-link');
            linkCell.appendChild(link);

            const typeCell = document.createElement('td');
            typeCell.textContent = item.includes('@') ? 'Email' : 'Website';

            const actionCell = document.createElement('td');
            const copyBtn = document.createElement('button');
            copyBtn.textContent = 'Copy';
            copyBtn.classList.add('btn', 'btn-secondary');
            copyBtn.style.padding = '5px 10px';
            copyBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(item);
                showNotification('Copied to clipboard!', 'success');
            });
            actionCell.appendChild(copyBtn);

            row.appendChild(linkCell);
            row.appendChild(typeCell);
            row.appendChild(actionCell);
            resultsBody.appendChild(row);
        });
    }

    function updateStats() {
        const totalWebsites = websitesData.length + filteredWebsitesData.length;
        totalResults.textContent = totalWebsites + emailsData.length;
        websitesCount.textContent = totalWebsites;
        emailsCount.textContent = emailsData.length;
    }

    function exportToCsv() {
        const dataToExport = emailsData.length > 0 ? emailsData
            : filteredWebsitesData.length > 0 ? filteredWebsitesData
            : websitesData.length > 0 ? websitesData : [];

        if (!dataToExport.length) {
            showNotification('No data available to export.', 'error');
            return;
        }

        const csv = convertToCSV(dataToExport);
        downloadCSV(csv, 'E-Com_Data_Export.csv');
        showNotification('CSV exported successfully!', 'success');
    }

    function showLoading() {
        loadingOverlay.classList.add('show');
        let progress = 0;
        const interval = setInterval(() => {
            progress += Math.random() * 10;
            if (progress > 90) clearInterval(interval);
            progressFill.style.width = `${progress}%`;
        }, 300);
    }

    function hideLoading() {
        loadingOverlay.classList.remove('show');
        progressFill.style.width = '0%';
    }

    function showNotification(message, type) {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.innerHTML = `
            <div class="notification-icon">
                <i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i>
            </div>
            <div class="notification-content">${message}</div>
            <button class="notification-close">
                <i class="fas fa-times"></i>
            </button>`;
        notification.querySelector('.notification-close').addEventListener('click', () => {
            notification.classList.add('hide');
            setTimeout(() => notification.remove(), 300);
        });
        document.getElementById('notification-center').appendChild(notification);
        setTimeout(() => {
            notification.classList.add('hide');
            setTimeout(() => notification.remove(), 300);
        }, 5000);
    }

    function parseCSV(text) {
        const lines = text.split('\n');
        const result = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line) {
                const matches = line.match(/(?:^|,)("(?:[^"](?:""[^"]))"|[^,])/g);
                if (matches) {
                    let value = matches[0].replace(/^,/, '').replace(/^"(.*)"$/, '$1').replace(/""/g, '"');
                    result.push(value);
                }
            }
        }
        return result.length > 0 && !result[0].includes('.') ? result.slice(1) : result;
    }

    function convertToCSV(dataArray) {
        return 'Website/Email\n' + dataArray.join('\n');
    }

    function downloadCSV(csv, filename) {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.setAttribute('download', filename);
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    async function callGeminiAPI(prompt) {
        const now = Date.now();
        const timeSinceLastRequest = now - lastRequestTime;
        if (timeSinceLastRequest < REQUEST_DELAY) {
            await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY - timeSinceLastRequest));
        }

        const cacheKey = prompt.substring(0, 100);
        if (responseCache[cacheKey]) return responseCache[cacheKey];

        lastRequestTime = Date.now();
        const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.7,
                    topP: 1,
                    topK: 32,
                    maxOutputTokens: 2048
                }
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error.message || 'API request failed');
        }

        const data = await response.json();
        const result = data.candidates[0].content.parts[0].text;
        responseCache[cacheKey] = result;
        return result;
    }

    function readCSVFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const websites = e.target.result
                    .split('\n')
                    .map(line => line.trim().split(',')[0])
                    .filter(line => line && line.includes('.'));
                resolve(websites);
            };
            reader.onerror = reject;
            reader.readAsText(file);
        });
    }
});
