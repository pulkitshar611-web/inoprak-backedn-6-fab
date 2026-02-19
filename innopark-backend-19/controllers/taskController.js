const pool = require('../config/db');

// Helper to update overdue tasks
const updateProcessOverdue = async (companyId) => {
  try {
    await pool.execute(
      `UPDATE tasks SET status = 'Overdue' 
             WHERE status = 'Pending' AND due_date < NOW() AND company_id = ?`,
      [companyId]
    );
  } catch (e) {
    console.error('Error updating overdue tasks:', e);
  }
};

const getAll = async (req, res) => {
  try {
    const companyId = req.user?.company_id || 1;
    const { assigned_to, status, priority, related_to_type, related_to_id, date_from, date_to, page = 1, limit = 50 } = req.query;
    const userRole = req.user?.role || 'EMPLOYEE';
    const userId = req.user?.id;

    // Auto-update overdue status
    await updateProcessOverdue(companyId);

    let query = `
            SELECT t.*, 
                   u.name as assigned_to_name, 
                   u.avatar as assigned_to_avatar,
                   c.name as created_by_name,
                   CASE 
                     WHEN t.related_to_type = 'lead' THEN l.person_name
                     WHEN t.related_to_type = 'deal' THEN d.name
                     WHEN t.related_to_type = 'contact' THEN con.name
                     WHEN t.related_to_type = 'company' THEN comp.name
                     ELSE NULL
                   END as related_entity_name
            FROM tasks t
            LEFT JOIN users u ON t.assigned_to = u.id
            LEFT JOIN users c ON t.created_by = c.id
            LEFT JOIN leads l ON t.related_to_type = 'lead' AND t.related_to_id = l.id
            LEFT JOIN deals d ON t.related_to_type = 'deal' AND t.related_to_id = d.id
            LEFT JOIN contacts con ON t.related_to_type = 'contact' AND t.related_to_id = con.id
            LEFT JOIN companies comp ON t.related_to_type = 'company' AND t.related_to_id = comp.id
            WHERE t.company_id = ? AND t.is_deleted = 0
        `;
    const params = [companyId];

    // Security: Non-admins only see their tasks
    if (userRole !== 'ADMIN' && userRole !== 'SUPERADMIN') {
      query += ' AND t.assigned_to = ?';
      params.push(userId);
    } else if (assigned_to) {
      query += ' AND t.assigned_to = ?';
      params.push(assigned_to);
    }

    if (status) {
      query += ' AND t.status = ?';
      params.push(status);
    }
    if (priority) {
      query += ' AND t.priority = ?';
      params.push(priority);
    }
    if (related_to_type) {
      query += ' AND t.related_to_type = ?';
      params.push(related_to_type);
    }
    if (related_to_id) {
      query += ' AND t.related_to_id = ?';
      params.push(related_to_id);
    }
    if (date_from) {
      query += ' AND DATE(t.due_date) >= ?';
      params.push(date_from);
    }
    if (date_to) {
      query += ' AND DATE(t.due_date) <= ?';
      params.push(date_to);
    }

    // Pagination
    const offset = (page - 1) * limit;
    query += ' ORDER BY t.due_date ASC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const [rows] = await pool.execute(query, params);

    // Count for pagination metadata
    const [countResult] = await pool.execute('SELECT COUNT(*) as total FROM tasks WHERE company_id = ? AND is_deleted = 0', [companyId]);

    res.json({
      success: true,
      data: rows,
      pagination: {
        total: countResult[0].total,
        page: parseInt(page),
        limit: parseInt(limit)
      }
    });
  } catch (err) {
    console.error('Get tasks error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

const create = async (req, res) => {
  try {
    const { title, description, due_date, priority, assigned_to, reminder_datetime, related_to_type, related_to_id } = req.body;
    const companyId = req.user?.company_id || 1;
    const createdBy = req.user?.id || 1;

    if (!title || !due_date || !assigned_to) {
      return res.status(400).json({ success: false, error: 'Title, Due Date, and Assigned User are required' });
    }

    const [result] = await pool.execute(
      `INSERT INTO tasks (company_id, title, description, due_date, priority, assigned_to, reminder_datetime, related_to_type, related_to_id, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [companyId, title, description, due_date, priority || 'Medium', assigned_to, reminder_datetime, related_to_type, related_to_id, createdBy]
    );

    res.status(201).json({ success: true, id: result.insertId, message: 'Task created successfully' });
  } catch (err) {
    console.error('Create task error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

const update = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const userId = req.user?.id;
    const userRole = req.user?.role || 'EMPLOYEE';

    // Security Check: Only assigned user or admin can update
    const [existing] = await pool.execute('SELECT assigned_to, created_by FROM tasks WHERE id = ?', [id]);
    if (existing.length === 0) return res.status(404).json({ success: false, error: 'Task not found' });

    const task = existing[0];
    if (userRole !== 'ADMIN' && userRole !== 'SUPERADMIN' && task.assigned_to !== userId && task.created_by !== userId) {
      return res.status(403).json({ success: false, error: 'Permission denied. You can only update your own tasks.' });
    }

    const allowed = ['title', 'description', 'due_date', 'priority', 'status', 'assigned_to', 'reminder_datetime', 'related_to_type', 'related_to_id'];
    const fields = [];
    const values = [];

    for (const key of Object.keys(updates)) {
      if (allowed.includes(key) && updates[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(updates[key]);
      }
    }

    if (fields.length === 0) return res.status(400).json({ success: false, error: 'No valid fields to update' });

    values.push(id);
    await pool.execute(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`, values);
    res.json({ success: true, message: 'Task updated successfully' });
  } catch (err) {
    console.error('Update task error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

const remove = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const userRole = req.user?.role || 'EMPLOYEE';

    // Security Check: Only assigned user or admin can delete
    const [existing] = await pool.execute('SELECT assigned_to, created_by FROM tasks WHERE id = ?', [id]);
    if (existing.length === 0) return res.status(404).json({ success: false, error: 'Task not found' });

    const task = existing[0];
    if (userRole !== 'ADMIN' && userRole !== 'SUPERADMIN' && task.assigned_to !== userId && task.created_by !== userId) {
      return res.status(403).json({ success: false, error: 'Permission denied. You can only delete your own tasks.' });
    }

    await pool.execute('UPDATE tasks SET is_deleted = 1 WHERE id = ?', [id]);
    res.json({ success: true, message: 'Task deleted successfully' });
  } catch (err) {
    console.error('Delete task error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

const markComplete = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.execute("UPDATE tasks SET status = 'Completed' WHERE id = ?", [id]);
    res.json({ success: true, message: 'Task marked as completed' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

const reopen = async (req, res) => {
  try {
    const { id } = req.params;
    const [task] = await pool.execute('SELECT due_date FROM tasks WHERE id = ?', [id]);
    let status = 'Pending';
    if (task.length > 0 && new Date(task[0].due_date) < new Date()) {
      status = 'Overdue';
    }

    await pool.execute("UPDATE tasks SET status = ? WHERE id = ?", [status, id]);
    res.json({ success: true, message: 'Task reopened' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

module.exports = { getAll, create, update, remove, markComplete, reopen };

