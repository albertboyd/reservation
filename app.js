const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const { DateTime } = require('luxon');

const app = express();
app.use(bodyParser.json());

const db = new sqlite3.Database(':memory:');

// Initialize database
db.serialize(() => {
    db.run(`CREATE TABLE providers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
    )`);

    db.run(`CREATE TABLE availability (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider_id INTEGER,
        start_time TEXT,
        end_time TEXT,
        FOREIGN KEY (provider_id) REFERENCES providers(id)
    )`);

    db.run(`CREATE TABLE reservations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider_id INTEGER,
        client_name TEXT,
        start_time TEXT,
        end_time TEXT,
        confirmed BOOLEAN DEFAULT 0,
        created_at TEXT,
        FOREIGN KEY (provider_id) REFERENCES providers(id)
    )`);
});

// Add provider availability
app.post('/providers/:providerId/availability', (req, res) => {
    const { providerId } = req.params;
    const { start_time, end_time } = req.body;

    db.run(
        `INSERT INTO availability (provider_id, start_time, end_time) VALUES (?, ?, ?)`,
        [providerId, start_time, end_time],
        function (err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.status(201).json({ message: 'Availability added successfully' });
        }
    );
});

// Get available slots
app.get('/providers/:providerId/availability', (req, res) => {
    const { providerId } = req.params;

    db.all(
        `SELECT * FROM availability WHERE provider_id = ?`,
        [providerId],
        (err, rows) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }

            const slots = [];
            rows.forEach(row => {
                let startTime = DateTime.fromISO(row.start_time);
                const endTime = DateTime.fromISO(row.end_time);

                while (startTime.plus({ minutes: 15 }) <= endTime) {
                    slots.push({
                        start_time: startTime.toISO(),
                        end_time: startTime.plus({ minutes: 15 }).toISO()
                    });
                    startTime = startTime.plus({ minutes: 15 });
                }
            });

            res.json(slots);
        }
    );
});

// Create a reservation
app.post('/reservations', (req, res) => {
    const { provider_id, client_name, start_time, end_time } = req.body;

    const startDateTime = DateTime.fromISO(start_time);
    if (startDateTime < DateTime.now().plus({ days: 1 })) {
        return res.status(400).json({ error: 'Reservations must be made at least 24 hours in advance' });
    }

    db.get(
        `SELECT * FROM reservations WHERE provider_id = ? AND start_time = ? AND confirmed = 1`,
        [provider_id, start_time],
        (err, row) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }

            if (row) {
                return res.status(400).json({ error: 'Slot already reserved' });
            }

            db.run(
                `INSERT INTO reservations (provider_id, client_name, start_time, end_time, created_at) VALUES (?, ?, ?, ?, ?)`,
                [provider_id, client_name, start_time, end_time, DateTime.now().toISO()],
                function (err) {
                    if (err) {
                        return res.status(500).json({ error: err.message });
                    }
                    res.status(201).json({ message: 'Reservation created successfully', reservation_id: this.lastID });
                }
            );
        }
    );
});

// Confirm a reservation
app.post('/reservations/:reservationId/confirm', (req, res) => {
    const { reservationId } = req.params;

    db.run(
        `UPDATE reservations SET confirmed = 1 WHERE id = ?`,
        [reservationId],
        function (err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json({ message: 'Reservation confirmed successfully' });
        }
    );
});

// Cleanup expired reservations
app.post('/cleanup', (req, res) => {
    const cutoffTime = DateTime.now().minus({ minutes: 30 }).toISO();

    db.run(
        `DELETE FROM reservations WHERE confirmed = 0 AND created_at < ?`,
        [cutoffTime],
        function (err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json({ message: 'Expired reservations cleaned up' });
        }
    );
});

app.listen(3000, () => {
    console.log('Server is running on port 3000');
});
