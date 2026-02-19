const pool = require('../config/db');

const getAll = async (req, res) => {
    try {
        const companyId = req.query.company_id || req.body.company_id || req.user?.company_id || 1;
        const { assigned_to, date_from, date_to, related_to_type, related_to_id } = req.query;
        const userRole = req.user?.role || 'EMPLOYEE';
        const userId = req.user?.id;

        let query = `
            SELECT m.*, 
                   u.name as assigned_to_name, 
                   u.avatar as assigned_to_avatar,
                   c.name as created_by_name
            FROM meetings m
            LEFT JOIN users u ON m.assigned_to = u.id
            LEFT JOIN users c ON m.created_by = c.id
            WHERE m.company_id = ? AND m.is_deleted = 0
        `;
        const params = [companyId];

        // Role-based visibility: Non-admins only see meetings assigned to them
        if (userRole !== 'ADMIN' && userRole !== 'SUPERADMIN') {
            query += ' AND m.assigned_to = ?';
            params.push(userId);
        } else if (assigned_to) {
            // Admins can filter by any user
            query += ' AND m.assigned_to = ?';
            params.push(assigned_to);
        }

        if (date_from) {
            query += ' AND m.meeting_date >= ?';
            params.push(date_from);
        }
        if (date_to) {
            query += ' AND m.meeting_date <= ?';
            params.push(date_to);
        }
        if (related_to_type && related_to_id) {
            query += ' AND m.related_to_type = ? AND m.related_to_id = ?';
            params.push(related_to_type, related_to_id);
        }

        query += ' ORDER BY m.meeting_date ASC, m.start_time ASC';

        const [rows] = await pool.execute(query, params);
        res.json({ success: true, data: rows });
    } catch (err) {
        console.error('Get meetings error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
};

const create = async (req, res) => {
    try {
        const { title, description, meeting_date, start_time, end_time, location, assigned_to, reminder_datetime, related_to_type, related_to_id } = req.body;
        const companyId = req.body.company_id || req.user?.company_id || 1;
        const createdBy = req.user?.id || 1;

        if (!title || !meeting_date || !start_time || !end_time || !assigned_to) {
            return res.status(400).json({ success: false, error: 'Title, Date, Start Time, End Time, and Assigned User are required' });
        }

        // Validate time
        if (start_time >= end_time) {
            return res.status(400).json({ success: false, error: 'End time must be after start time' });
        }

        const [result] = await pool.execute(
            `INSERT INTO meetings (company_id, title, description, meeting_date, start_time, end_time, location, assigned_to, reminder_datetime, related_to_type, related_to_id, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [companyId, title, description, meeting_date, start_time, end_time, location, assigned_to, reminder_datetime, related_to_type, related_to_id, createdBy]
        );

        const newMeetingId = result.insertId;
        const [newMeeting] = await pool.execute('SELECT * FROM meetings WHERE id = ?', [newMeetingId]);

        res.status(201).json({ success: true, data: newMeeting[0], message: 'Meeting created successfully' });
    } catch (err) {
        console.error('Create meeting error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
};

const update = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        const allowed = ['title', 'description', 'meeting_date', 'start_time', 'end_time', 'location', 'assigned_to', 'reminder_datetime', 'related_to_type', 'related_to_id'];

        const fields = [];
        const values = [];

        // Time validation if both provided or merged
        // For simplicity, if start/end time are updated, we trust frontend or perform simple check if both exist in updates
        if (updates.start_time && updates.end_time && updates.start_time >= updates.end_time) {
            return res.status(400).json({ success: false, error: 'End time must be after start time' });
        }

        for (const key of Object.keys(updates)) {
            if (allowed.includes(key) && updates[key] !== undefined) {
                fields.push(`${key} = ?`);
                values.push(updates[key]);
            }
        }

        if (fields.length === 0) return res.status(400).json({ success: false, error: 'No valid fields to update' });

        values.push(id);

        await pool.execute(`UPDATE meetings SET ${fields.join(', ')} WHERE id = ?`, values);

        const [updatedMeeting] = await pool.execute('SELECT * FROM meetings WHERE id = ?', [id]);
        res.json({ success: true, data: updatedMeeting[0], message: 'Meeting updated successfully' });
    } catch (err) {
        console.error('Update meeting error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
};

const remove = async (req, res) => {
    try {
        const { id } = req.params;
        await pool.execute('UPDATE meetings SET is_deleted = 1 WHERE id = ?', [id]);
        res.json({ success: true, data: { id, deleted: true } });
    } catch (err) {
        console.error('Delete meeting error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
};

module.exports = { getAll, create, update, remove };
