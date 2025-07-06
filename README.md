This project uses the puppeteer library for headless browsing. It goes to the Stockmock's login page and logs in to the website using the credentials provided by the user in the web interface and performs all the actions required for the options trading simulation using your defined startegy for the range of dates user wants to.
![Screenshot 2025-07-06 152902](https://github.com/user-attachments/assets/2b96ef6a-4b18-44e0-a61e-c1fe40aa00d2)

Then the server.js code send the simulation result to N8N via webhook and N8N automatically populates the google sheet with the simulation result data.
N8N workflow:
![image](https://github.com/user-attachments/assets/95f2c867-9ef1-490d-bcd4-7dad17a11f8d)

This project completes 3 main files:
1) Server.js: This contains the pupeteer code wrapped in express js
2) Index.html and Script.js: Frontend Code.
