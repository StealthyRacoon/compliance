const { createJob } = require("../core/jobs");

// --------------------------------------------------
// SCHEDULER LOOP
// --------------------------------------------------

async function loop() {

    while (true) {

        try {

            console.log("Scheduling jobs...");

            // --------------------------------------
            // EXAMPLE
            // --------------------------------------

            await createJob("discover_sites", {
                scheduled: true,
                timestamp: Date.now()
            });

        } catch (err) {

            console.error("Scheduler error:", err);
        }

        // ------------------------------------------
        // WAIT 60s
        // ------------------------------------------

        await new Promise(resolve =>
            setTimeout(resolve, 60000)
        );
    }
}

// --------------------------------------------------
// START SCHEDULER
// --------------------------------------------------

console.log("Scheduler started");

loop();