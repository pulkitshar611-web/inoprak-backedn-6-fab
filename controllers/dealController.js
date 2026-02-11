// =====================================================
// Deal Controller
// =====================================================

const pool = require('../config/db');

/**
 * Normalize unit value to valid ENUM values
 */
const normalizeUnit = (unit) => {
    const validUnits = ['Pcs', 'Kg', 'Hours', 'Days'];
    if (!unit) return 'Pcs';
    if (validUnits.includes(unit)) return unit;

    const unitLower = String(unit).toLowerCase().trim();
    if (unitLower.includes('pc') || unitLower.includes('piece')) return 'Pcs';
    else if (unitLower.includes('kg') || unitLower.includes('kilogram')) return 'Kg';
    else if (unitLower.includes('hour')) return 'Hours';
    else if (unitLower.includes('day')) return 'Days';
    else return 'Pcs';
};

/** Deals table status ENUM: Draft, Sent, Accepted, Declined, Expired. Normalize incoming value to avoid "Data truncated". */
const DEAL_STATUS_ALLOWED = ['Draft', 'Sent', 'Accepted', 'Declined', 'Expired'];
const normalizeDealStatus = (status) => {
    if (!status || typeof status !== 'string') return 'Draft';
    const s = String(status).trim();
    if (!s) return 'Draft';
    const lower = s.toLowerCase();
    const found = DEAL_STATUS_ALLOWED.find((v) => v.toLowerCase() === lower);
    return found || 'Draft';
};

const generateDealNumber = async (companyId) => {
    try {
        const [result] = await pool.execute(
            `SELECT deal_number FROM deals 
       WHERE deal_number LIKE 'DEAL#%'
       ORDER BY LENGTH(deal_number) DESC, deal_number DESC 
       LIMIT 1`
        );

        let nextNum = 1;
        if (result.length > 0 && result[0].deal_number) {
            const numMatch = result[0].deal_number.match(/DEAL#(\d+)/);
            if (numMatch && numMatch[1]) {
                nextNum = parseInt(numMatch[1], 10) + 1;
            }
        }

        let dealNumber = `DEAL#${String(nextNum).padStart(3, '0')}`;
        let attempts = 0;
        while (attempts < 100) {
            const [existing] = await pool.execute('SELECT id FROM deals WHERE deal_number = ?', [dealNumber]);
            if (existing.length === 0) return dealNumber;
            nextNum++;
            dealNumber = `DEAL#${String(nextNum).padStart(3, '0')}`;
            attempts++;
        }
        return `DEAL#${Date.now().toString().slice(-6)}`;
    } catch (error) {
        console.error('Error generating deal number:', error);
        return `DEAL#${Date.now().toString().slice(-6)}`;
    }
};

const calculateTotals = (items, discount, discountType) => {
    let subTotal = 0;
    items.forEach(item => {
        const quantity = parseFloat(item.quantity) || 0;
        const unitPrice = parseFloat(item.unit_price) || 0;
        const taxRate = parseFloat(item.tax_rate) || 0;
        let itemAmount = quantity * unitPrice;
        if (taxRate > 0) itemAmount += (itemAmount * taxRate / 100);
        subTotal += (parseFloat(item.amount) || itemAmount);
    });

    let discountAmount = 0;
    if (discountType === '%') {
        discountAmount = (subTotal * parseFloat(discount || 0)) / 100;
    } else {
        discountAmount = parseFloat(discount || 0);
    }

    const total = subTotal - discountAmount;
    return { sub_total: subTotal, discount_amount: discountAmount, tax_amount: 0, total };
};

const getAll = async (req, res) => {
    try {
        const filterCompanyId = req.query.company_id || req.body.company_id || req.companyId;
        if (!filterCompanyId) return res.status(400).json({ success: false, error: 'company_id is required' });

        let whereClause = 'WHERE e.company_id = ? AND e.is_deleted = 0';
        const params = [filterCompanyId];

        if (req.query.status && req.query.status !== 'All') {
            whereClause += ' AND UPPER(e.status) = UPPER(?)';
            params.push(req.query.status);
        }
        if (req.query.search) {
            whereClause += ' AND (e.deal_number LIKE ? OR e.title LIKE ? OR c.company_name LIKE ?)';
            params.push(`%${req.query.search}%`, `%${req.query.search}%`, `%${req.query.search}%`);
        }
        if (req.query.lead_id) {
            whereClause += ' AND e.lead_id = ?';
            params.push(req.query.lead_id);
        }
        if (req.query.client_id) {
            whereClause += ' AND (e.client_id = ? OR c.owner_id = ?)';
            params.push(req.query.client_id, req.query.client_id);
        }

        const [deals] = await pool.execute(
            `SELECT e.*, 
                    c.company_name as client_name, 
                    p.project_name, 
                    comp.name as company_name, 
                    u.name as created_by_name,
                    ds.name as stage_name,
                    ds.color as stage_color,
                    dp.name as pipeline_name
       FROM deals e
       LEFT JOIN clients c ON e.client_id = c.id
       LEFT JOIN projects p ON e.project_id = p.id
       LEFT JOIN companies comp ON e.company_id = comp.id
       LEFT JOIN users u ON e.created_by = u.id
       LEFT JOIN deal_pipeline_stages ds ON e.stage_id = ds.id
       LEFT JOIN deal_pipelines dp ON e.pipeline_id = dp.id
       ${whereClause}
       ORDER BY e.created_at DESC`,
            params
        );

        for (let deal of deals) {
            const [items] = await pool.execute('SELECT * FROM deal_items WHERE deal_id = ?', [deal.id]);
            deal.items = items || [];
        }

        res.json({ success: true, data: deals });
    } catch (error) {
        console.error('Get deals error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

const getById = async (req, res) => {
    try {
        const [deals] = await pool.execute(
            `SELECT e.*, 
                    c.company_name as client_name, 
                    p.project_name, 
                    comp.name as company_name, 
                    u.name as created_by_name,
                    ds.name as stage_name,
                    ds.color as stage_color,
                    dp.name as pipeline_name
       FROM deals e
       LEFT JOIN clients c ON e.client_id = c.id
       LEFT JOIN projects p ON e.project_id = p.id
       LEFT JOIN companies comp ON e.company_id = comp.id
       LEFT JOIN users u ON e.created_by = u.id
       LEFT JOIN deal_pipeline_stages ds ON e.stage_id = ds.id
       LEFT JOIN deal_pipelines dp ON e.pipeline_id = dp.id
       WHERE e.id = ? AND e.is_deleted = 0`,
            [req.params.id]
        );

        if (deals.length === 0) return res.status(404).json({ success: false, error: 'Deal not found' });

        const [items] = await pool.execute('SELECT * FROM deal_items WHERE deal_id = ?', [req.params.id]);
        deals[0].items = items;

        // Linked contacts (from deal_contacts: references master contacts table only)
        try {
            const [dcRows] = await pool.execute(
                `SELECT dc.id, dc.contact_id, dc.is_primary, dc.role, ct.name, ct.email, ct.phone, ct.job_title, ct.company as contact_company
                 FROM deal_contacts dc
                 INNER JOIN contacts ct ON dc.contact_id = ct.id AND ct.is_deleted = 0
                 WHERE dc.deal_id = ? ORDER BY dc.is_primary DESC, dc.created_at ASC`,
                [req.params.id]
            );
            deals[0].linked_contacts = dcRows || [];
        } catch (e) {
            deals[0].linked_contacts = [];
        }
        // If no deal_contacts but deal has contact_id, include that contact as primary
        if (deals[0].linked_contacts.length === 0 && deals[0].contact_id) {
            const [pc] = await pool.execute(
                'SELECT id as contact_id, name, email, phone, job_title, company as contact_company FROM contacts WHERE id = ? AND is_deleted = 0',
                [deals[0].contact_id]
            );
            if (pc.length > 0) deals[0].linked_contacts = [{ ...pc[0], is_primary: 1, role: null }];
        }

        res.json({ success: true, data: deals[0] });
    } catch (error) {
        console.error('Get deal error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Get linked contacts for a deal (master contact records only)
 * GET /api/v1/deals/:id/contacts
 */
const getDealContacts = async (req, res) => {
    try {
        const dealId = req.params.id;
        const [exists] = await pool.execute('SELECT id FROM deals WHERE id = ? AND is_deleted = 0', [dealId]);
        if (exists.length === 0) return res.status(404).json({ success: false, error: 'Deal not found' });

        const [rows] = await pool.execute(
            `SELECT dc.id, dc.contact_id, dc.is_primary, dc.role, ct.name, ct.email, ct.phone, ct.job_title, ct.company as contact_company
             FROM deal_contacts dc
             INNER JOIN contacts ct ON dc.contact_id = ct.id AND ct.is_deleted = 0
             WHERE dc.deal_id = ? ORDER BY dc.is_primary DESC, dc.created_at ASC`,
            [dealId]
        );
        res.json({ success: true, data: rows || [] });
    } catch (error) {
        console.error('Get deal contacts error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Link an existing contact to a deal (no duplicate contact creation)
 * POST /api/v1/deals/:id/contacts  body: { contact_id, is_primary?, role? }
 */
const addContactToDeal = async (req, res) => {
    try {
        const dealId = req.params.id;
        const { contact_id, is_primary, role } = req.body || {};
        if (!contact_id) return res.status(400).json({ success: false, error: 'contact_id is required' });

        const [dealExists] = await pool.execute('SELECT id FROM deals WHERE id = ? AND is_deleted = 0', [dealId]);
        if (dealExists.length === 0) return res.status(404).json({ success: false, error: 'Deal not found' });

        const [contactExists] = await pool.execute('SELECT id FROM contacts WHERE id = ? AND is_deleted = 0', [contact_id]);
        if (contactExists.length === 0) return res.status(404).json({ success: false, error: 'Contact not found' });

        const [tableExists] = await pool.execute(
            "SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'deal_contacts'"
        );
        if (tableExists.length === 0) return res.status(400).json({ success: false, error: 'deal_contacts table not found' });

        if (is_primary) {
            await pool.execute('UPDATE deal_contacts SET is_primary = 0 WHERE deal_id = ?', [dealId]);
        }
        await pool.execute(
            'INSERT INTO deal_contacts (deal_id, contact_id, is_primary, role) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE is_primary = VALUES(is_primary), role = VALUES(role)',
            [dealId, contact_id, is_primary ? 1 : 0, role ?? null]
        );
        const [rows] = await pool.execute(
            `SELECT dc.id, dc.contact_id, dc.is_primary, dc.role, ct.name, ct.email, ct.phone FROM deal_contacts dc INNER JOIN contacts ct ON dc.contact_id = ct.id WHERE dc.deal_id = ? AND dc.contact_id = ?`,
            [dealId, contact_id]
        );
        res.status(201).json({ success: true, data: rows[0] || { contact_id, is_primary: !!is_primary, role } });
    } catch (error) {
        console.error('Add contact to deal error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Unlink a contact from a deal (contact master record remains)
 * DELETE /api/v1/deals/:id/contacts/:contactId
 */
const removeContactFromDeal = async (req, res) => {
    try {
        const { id: dealId, contactId } = req.params;
        const [tableExists] = await pool.execute(
            "SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'deal_contacts'"
        );
        if (tableExists.length === 0) return res.status(400).json({ success: false, error: 'deal_contacts table not found' });

        const [result] = await pool.execute('DELETE FROM deal_contacts WHERE deal_id = ? AND contact_id = ?', [dealId, contactId]);
        if (result.affectedRows === 0) return res.status(404).json({ success: false, error: 'Link not found' });
        res.json({ success: true, data: { unlinked: true } });
    } catch (error) {
        console.error('Remove contact from deal error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

const create = async (req, res) => {
    try {
        const {
            deal_date, valid_till, currency, client_id, project_id, lead_id, title,
            calculate_tax, description, note, terms, tax, second_tax,
            discount, discount_type, items = [], status, total, sub_total
        } = req.body;

        const companyId = req.body.company_id || req.query.company_id || 1;
        const deal_number = await generateDealNumber(companyId);
        const createdBy = req.body.user_id || req.userId || 1;

        let totals = { sub_total: 0, discount_amount: 0, tax_amount: 0, total: 0 };

        // If items exist, calculate from items
        if (items.length > 0) {
            totals = calculateTotals(items, discount, discount_type);
        }
        // Otherwise, use provided total/sub_total values
        else if (total || sub_total) {
            totals.total = parseFloat(total) || 0;
            totals.sub_total = parseFloat(sub_total) || parseFloat(total) || 0;
            totals.discount_amount = 0;
            totals.tax_amount = 0;
        }

        const [result] = await pool.execute(
            `INSERT INTO deals (
        company_id, deal_number, deal_date, valid_till, currency, client_id, project_id, lead_id, title,
        calculate_tax, description, note, terms, tax, second_tax, discount, discount_type,
        sub_total, discount_amount, tax_amount, total, created_by, status, pipeline_id, stage_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                companyId, deal_number, deal_date ?? null, valid_till ?? null, currency || 'USD',
                client_id ?? null, project_id ?? null, lead_id ?? null, title ?? null,
                calculate_tax || 'After Discount', description ?? null, note ?? null, terms || 'Thank you for your business.',
                tax ?? null, second_tax ?? null, discount ?? 0, discount_type || '%',
                totals.sub_total, totals.discount_amount, totals.tax_amount, totals.total,
                createdBy, normalizeDealStatus(status),
                req.body.pipeline_id ?? null, req.body.stage_id ?? null
            ]
        );

        const dealId = result.insertId;

        if (items.length > 0) {
            const itemValues = items.map(item => [
                dealId,
                item.item_name ?? null,
                item.description ?? null,
                item.quantity ?? 1,
                normalizeUnit(item.unit),
                item.unit_price ?? 0,
                item.tax ?? null,
                item.tax_rate ?? 0,
                item.file_path ?? null,
                item.amount ?? ((item.quantity ?? 1) * (item.unit_price ?? 0))
            ]);

            await pool.query(
                `INSERT INTO deal_items (deal_id, item_name, description, quantity, unit, unit_price, tax, tax_rate, file_path, amount) VALUES ?`,
                [itemValues]
            );
        }

        const [newDeal] = await pool.execute('SELECT * FROM deals WHERE id = ?', [dealId]);
        const [newItems] = await pool.execute('SELECT * FROM deal_items WHERE deal_id = ?', [dealId]);
        newDeal[0].items = newItems;

        res.status(201).json({ success: true, data: newDeal[0] });
    } catch (error) {
        console.error('Create deal error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

const update = async (req, res) => {
    try {
        const { id } = req.params;
        const { items, ...fields } = req.body;

        const [exists] = await pool.execute('SELECT id FROM deals WHERE id = ?', [id]);
        if (exists.length === 0) return res.status(404).json({ success: false, error: 'Deal not found' });

        if (Object.keys(fields).length > 0) {
            const updates = [];
            const values = [];
            for (const [key, val] of Object.entries(fields)) {
                if (val !== undefined && key !== 'items' && key !== 'id') {
                    updates.push(`${key} = ?`);
                    values.push(key === 'status' ? normalizeDealStatus(val) : val);
                }
            }
            if (updates.length > 0) {
                updates.push('updated_at = CURRENT_TIMESTAMP');
                values.push(id);
                await pool.execute(`UPDATE deals SET ${updates.join(', ')} WHERE id = ?`, values);
            }
        }

        if (items) {
            await pool.execute('DELETE FROM deal_items WHERE deal_id = ?', [id]);
            if (items.length > 0) {
                const itemValues = items.map(item => [
                    id,
                    item.item_name ?? null,
                    item.description ?? null,
                    item.quantity ?? 1,
                    normalizeUnit(item.unit),
                    item.unit_price ?? 0,
                    item.tax ?? null,
                    item.tax_rate ?? 0,
                    item.file_path ?? null,
                    item.amount ?? ((item.quantity ?? 1) * (item.unit_price ?? 0))
                ]);

                await pool.query(
                    `INSERT INTO deal_items (deal_id, item_name, description, quantity, unit, unit_price, tax, tax_rate, file_path, amount) VALUES ?`,
                    [itemValues]
                );
            }
        }

        const [updated] = await pool.execute('SELECT * FROM deals WHERE id = ?', [id]);
        const [updatedItems] = await pool.execute('SELECT * FROM deal_items WHERE deal_id = ?', [id]);
        updated[0].items = updatedItems;

        res.json({ success: true, data: updated[0] });

    } catch (error) {
        console.error('Update deal error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

const deleteDeal = async (req, res) => {
    try {
        await pool.execute('UPDATE deals SET is_deleted = 1 WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Deal deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

const getFilters = async (req, res) => {
    res.json({ success: true, data: {} }); // Placeholder for filters if needed
}

const updateStatus = async (req, res) => {
    // Re-use Update
    return update(req, res);
}

const updateStage = async (req, res) => {
    try {
        const { id } = req.params;
        const { stage_id, pipeline_id } = req.body;

        if (!stage_id) {
            return res.status(400).json({ success: false, error: 'stage_id is required' });
        }

        const updates = ['stage_id = ?'];
        const values = [stage_id];

        if (pipeline_id) {
            updates.push('pipeline_id = ?');
            values.push(pipeline_id);
        }

        updates.push('updated_at = CURRENT_TIMESTAMP');
        values.push(id);

        const [result] = await pool.execute(
            `UPDATE deals SET ${updates.join(', ')} WHERE id = ?`,
            values
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Deal not found' });
        }

        res.json({ success: true, message: 'Deal stage updated successfully' });
    } catch (error) {
        console.error('Update deal stage error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
}

/**
 * Get deal activities
 * GET /api/v1/deals/:id/activities
 */
const getDealActivities = async (req, res) => {
    try {
        const { id } = req.params;
        const { type } = req.query;

        let whereClause = 'WHERE reference_type = ? AND reference_id = ? AND is_deleted = 0';
        const params = ['deal', id];

        if (type) {
            whereClause += ' AND type = ?';
            params.push(type);
        }

        const [activities] = await pool.execute(
            `SELECT a.*, u.name as created_by_name
             FROM activities a
             LEFT JOIN users u ON a.created_by = u.id
             ${whereClause}
             ORDER BY a.created_at DESC`,
            params
        );

        res.json({
            success: true,
            data: activities
        });
    } catch (error) {
        console.error('Get deal activities error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch activities'
        });
    }
};

/**
 * Add activity to deal
 * POST /api/v1/deals/:id/activities
 */
const addDealActivity = async (req, res) => {
    try {
        const { id } = req.params;
        const { type, description, follow_up_at, meeting_link, is_pinned } = req.body;
        const companyId = req.companyId || req.body.company_id || req.query.company_id;
        const userId = req.userId;

        if (!type || !description) {
            return res.status(400).json({
                success: false,
                error: 'type and description are required'
            });
        }

        // Insert activity
        const [result] = await pool.execute(
            `INSERT INTO activities (
                type, description, reference_type, reference_id, deal_id,
                company_id, created_by, follow_up_at, meeting_link, is_pinned
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                type, description, 'deal', id, id, companyId, userId,
                follow_up_at || null, meeting_link || null, is_pinned || 0
            ]
        );

        res.status(201).json({
            success: true,
            data: { id: result.insertId },
            message: 'Activity added successfully'
        });
    } catch (error) {
        console.error('Add deal activity error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to add activity'
        });
    }
};

module.exports = {
    getAll,
    getById,
    create,
    update,
    delete: deleteDeal,
    getFilters,
    updateStatus,
    updateStage,
    getDealContacts,
    addContactToDeal,
    removeContactFromDeal,
    getDealActivities,
    addDealActivity
};

