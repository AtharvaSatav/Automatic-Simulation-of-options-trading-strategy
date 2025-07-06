document.addEventListener('DOMContentLoaded', () => {
    const phoneNumberInput = document.getElementById('phoneNumber');
    const passwordInput = document.getElementById('password');
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');
    const loginButton = document.getElementById('loginButton');
    const outputDiv = document.getElementById('output');
    const messageDiv = document.getElementById('message');
    const loadingDiv = document.getElementById('loading');
    const togglePasswordButton = document.getElementById('togglePassword'); // Get the new toggle button

    // Make the runSimulation function asynchronous
    loginButton.addEventListener('click', runSimulation);

    // --- New Event Listener for Password Toggle ---
    if (togglePasswordButton) { // Check if the button exists
        togglePasswordButton.addEventListener('click', () => {
            if (passwordInput.type === 'password') {
                passwordInput.type = 'text';
                togglePasswordButton.textContent = 'Hide';
            } else {
                passwordInput.type = 'password';
                togglePasswordButton.textContent = 'Show';
            }
        });
    }
    // --- End New Event Listener ---

    function runSimulation() {
        const phoneNumber = phoneNumberInput.value.trim();
        const password = passwordInput.value.trim();
        const startDate = startDateInput.value;
        const endDate = endDateInput.value;

        if (!phoneNumber || !password || !startDate || !endDate) {
            messageDiv.textContent = 'Please enter phone number, password, start date, and end date.';
            messageDiv.classList.add('error'); // Ensure error class is applied
            return;
        }

        // Clear previous output and messages
        messageDiv.textContent = '';
        messageDiv.classList.remove('error');
        outputDiv.innerHTML = '';
        loadingDiv.style.display = 'block';
        loginButton.disabled = true;

        const controller = new AbortController();
        const signal = controller.signal;

        try {
            fetch('/run-puppeteer', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ phoneNumber, password, startDate, endDate }),
                signal: signal
            })
            .then(response => {
                const contentType = response.headers.get('Content-Type');
                if (contentType && contentType.includes('text/event-stream')) {
                    const reader = response.body.getReader();
                    const decoder = new TextDecoder('utf-8');
                    let buffer = '';

                    const processStream = async () => {
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) {
                                console.log('Stream complete.');
                                break;
                            }
                            buffer += decoder.decode(value, { stream: true });

                            let eventEnd;
                            while ((eventEnd = buffer.indexOf('\n\n')) !== -1) {
                                const eventChunk = buffer.substring(0, eventEnd);
                                buffer = buffer.substring(eventEnd + 2);

                                const lines = eventChunk.split('\n');
                                let eventType = 'message';
                                let eventData = '';

                                for (const line of lines) {
                                    if (line.startsWith('event:')) {
                                        eventType = line.substring('event:'.length).trim();
                                    } else if (line.startsWith('data:')) {
                                        eventData += line.substring('data:'.length).trim();
                                    }
                                }

                                try {
                                    const parsedData = JSON.parse(eventData);
                                    handleStreamEvent(eventType, parsedData);
                                } catch (e) {
                                    console.error('Failed to parse stream data or handle event:', e, 'Data:', eventData);
                                }
                            }
                        }
                    };
                    processStream().finally(() => {
                        loadingDiv.style.display = 'none';
                        loginButton.disabled = false;
                    });

                } else {
                    return response.json().then(data => {
                        messageDiv.textContent = `Error: ${data.error || 'Something went wrong on the server before streaming started.'}`;
                        messageDiv.classList.add('error'); // Apply error class
                        loadingDiv.style.display = 'none';
                        loginButton.disabled = false;
                    });
                }
            })
            .catch(error => {
                if (error.name === 'AbortError') {
                    messageDiv.textContent = 'Simulation cancelled.';
                } else {
                    console.error('Fetch error for streaming:', error);
                    messageDiv.textContent = `Network error: ${error.message}. Check console for details.`;
                }
                messageDiv.classList.add('error'); // Apply error class
                loadingDiv.style.display = 'none';
                loginButton.disabled = false;
            });

        } catch (error) {
            console.error('Error initiating fetch for streaming:', error);
            messageDiv.textContent = `Client-side error: ${error.message}.`;
            messageDiv.classList.add('error'); // Apply error class
            loadingDiv.style.display = 'none';
            loginButton.disabled = false;
        }
    }

    function handleStreamEvent(eventType, data) {
        if (eventType === 'start') {
            messageDiv.textContent = data.message;
            outputDiv.innerHTML += `<h3>${data.message}</h3>`;
        } else if (eventType === 'update') {
            const dateSection = document.createElement('div');
            dateSection.classList.add('date-result');
            let headerClass = 'text-success';
            if (data.status === 'error') {
                 headerClass = 'text-danger';
            }

            dateSection.innerHTML = `
                <h4 class="${headerClass}">Simulation for ${data.date} (${data.status})</h4>
                <pre>${data.result}</pre>
                <hr>
            `;
            outputDiv.appendChild(dateSection);
            outputDiv.scrollTop = outputDiv.scrollHeight;
            messageDiv.textContent = `Processed ${data.date}. Status: ${data.status}.`;

        } else if (eventType === 'progress') {
            messageDiv.textContent = data.message;
        } else if (eventType === 'complete') {
            messageDiv.textContent = data.message;
            outputDiv.innerHTML += `<h3>${data.message}</h3>`;
        } else if (eventType === 'error') {
            messageDiv.textContent = `Simulation Error: ${data.message}`;
            outputDiv.innerHTML += `<h3 class="text-danger">Error: ${data.message}</h3>`;
        } else {
            console.warn('Unknown event type:', eventType, data);
        }
    }
});