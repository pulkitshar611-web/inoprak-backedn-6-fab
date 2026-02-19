// =====================================================
// Company Controller
// =====================================================

const pool = require('../config/db');

/**
 * Ensure companies table has all required columns
 * Auto-adds email and phone columns if they don't exist
 */
const ensureTableColumns = async () => {
  try {
    // Check if email column exists
    const [emailColumns] = await pool.execute(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'companies' AND COLUMN_NAME = 'email'
    `);

    if (emailColumns.length === 0) {
      await pool.execute(`ALTER TABLE companies ADD COLUMN email VARCHAR(255) NULL AFTER name`);
      console.log('Added email column to companies table');
    }

    // Check if phone column exists
    const [phoneColumns] = await pool.execute(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'companies' AND COLUMN_NAME = 'phone'
    `);

    if (phoneColumns.length === 0) {
      await pool.execute(`ALTER TABLE companies ADD COLUMN phone VARCHAR(50) NULL AFTER email`);
      console.log('Added phone column to companies table');
    }

    return true;
  } catch (error) {
    console.error('Error ensuring company table columns:', error);
    return false;
  }
};

/**
 * Get all companies
 * GET /api/v1/companies
 */
const getAll = async (req, res) => {
  try {
    // Ensure table has required columns
    await ensureTableColumns();

    const { search, lead_id } = req.query;

    let whereClause = 'WHERE is_deleted = 0';
    const params = [];

    if (lead_id) {
      whereClause += ' AND lead_id = ?';
      params.push(lead_id);
    }

    if (search) {
      whereClause += ' AND name LIKE ?';
      params.push(`%${search}%`);
    }

    // Get all companies without pagination
    const [companies] = await pool.execute(
      `SELECT * FROM companies 
       ${whereClause}
       ORDER BY created_at DESC`,
      params
    );

    res.json({
      success: true,
      data: companies
    });
  } catch (error) {
    console.error('Get companies error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch companies'
    });
  }
};

/**
 * Get company by ID
 * GET /api/v1/companies/:id
 */
const getById = async (req, res) => {
  try {
    // Ensure table has required columns
    await ensureTableColumns();

    const { id } = req.params;

    const [companies] = await pool.execute(
      `SELECT * FROM companies 
       WHERE id = ? AND is_deleted = 0`,
      [id]
    );

    if (companies.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Company not found'
      });
    }

    res.json({
      success: true,
      data: companies[0]
    });
  } catch (error) {
    console.error('Get company by ID error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch company'
    });
  }
};

/**
 * Create new company
 * POST /api/v1/companies
 */
const create = async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      industry,
      website,
      address,
      notes,
      logo,
      currency = 'USD',
      timezone = 'UTC',
      lead_id
    } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Company name is required'
      });
    }

    const [result] = await pool.execute(
      `INSERT INTO companies (name, email, phone, industry, website, address, notes, logo, currency, timezone, lead_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, email ?? null, phone ?? null, industry ?? null, website ?? null, address ?? null, notes ?? null, logo ?? null, currency, timezone, lead_id ?? null]
    );

    const [newCompany] = await pool.execute(
      `SELECT * FROM companies WHERE id = ?`,
      [result.insertId]
    );

    res.status(201).json({
      success: true,
      data: newCompany[0],
      message: 'Company created successfully'
    });
  } catch (error) {
    console.error('Create company error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create company'
    });
  }
};

/**
 * Update company
 * PUT /api/v1/companies/:id
 */
const update = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      email,
      phone,
      industry,
      website,
      address,
      notes,
      logo,
      currency,
      timezone,
      package_id
    } = req.body;

    // Check if company exists
    const [existing] = await pool.execute(
      `SELECT id FROM companies 
       WHERE id = ? AND is_deleted = 0`,
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Company not found'
      });
    }

    const updateFields = [];
    const updateValues = [];

    if (name !== undefined) {
      updateFields.push('name = ?');
      updateValues.push(name);
    }
    if (email !== undefined) {
      updateFields.push('email = ?');
      updateValues.push(email || null);
    }
    if (phone !== undefined) {
      updateFields.push('phone = ?');
      updateValues.push(phone || null);
    }
    if (industry !== undefined) {
      updateFields.push('industry = ?');
      updateValues.push(industry || null);
    }
    if (website !== undefined) {
      updateFields.push('website = ?');
      updateValues.push(website || null);
    }
    if (address !== undefined) {
      updateFields.push('address = ?');
      updateValues.push(address || null);
    }
    if (notes !== undefined) {
      updateFields.push('notes = ?');
      updateValues.push(notes || null);
    }
    if (logo !== undefined) {
      updateFields.push('logo = ?');
      updateValues.push(logo);
    }
    if (currency !== undefined) {
      updateFields.push('currency = ?');
      updateValues.push(currency);
    }
    if (timezone !== undefined) {
      updateFields.push('timezone = ?');
      updateValues.push(timezone);
    }
    if (package_id !== undefined) {
      updateFields.push('package_id = ?');
      updateValues.push(package_id || null);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No fields to update'
      });
    }

    await pool.execute(
      `UPDATE companies 
       SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [...updateValues, id]
    );

    const [updated] = await pool.execute(
      `SELECT * FROM companies WHERE id = ?`,
      [id]
    );

    res.json({
      success: true,
      data: updated[0],
      message: 'Company updated successfully'
    });
  } catch (error) {
    console.error('Update company error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update company'
    });
  }
};

/**
 * Delete company (soft delete)
 * DELETE /api/v1/companies/:id
 */
const deleteCompany = async (req, res) => {
  try {
    const { id } = req.params;

    const [existing] = await pool.execute(
      `SELECT id FROM companies 
       WHERE id = ? AND is_deleted = 0`,
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Company not found'
      });
    }

    await pool.execute(
      `UPDATE companies 
       SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [id]
    );

    res.json({
      success: true,
      message: 'Company deleted successfully'
    });
  } catch (error) {
    console.error('Delete company error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete company'
    });
  }
};

/**
 * Get company with linked contacts and activities
 * GET /api/v1/companies/:id/details
 */
const getCompanyWithDetails = async (req, res) => {
  try {
    const { id } = req.params;

    // Get company
    const [companies] = await pool.execute(
      `SELECT * FROM companies WHERE id = ? AND is_deleted = 0`,
      [id]
    );

    if (companies.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Company not found'
      });
    }

    const company = companies[0];

    // Get linked contacts from company_contacts
    const [contacts] = await pool.execute(
      `SELECT * FROM company_contacts
       WHERE company_id = ? AND is_deleted = 0
       ORDER BY is_primary DESC, created_at DESC`,
      [id]
    );
    company.contacts = contacts;

    // Get activities count
    const [activityCount] = await pool.execute(
      `SELECT COUNT(*) as count FROM activities 
       WHERE reference_type = 'company' AND reference_id = ? AND is_deleted = 0`,
      [id]
    );
    company.activities_count = activityCount[0].count;

    res.json({
      success: true,
      data: company
    });
  } catch (error) {
    console.error('Get company details error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch company details'
    });
  }
};

/**
 * Get company activities
 * GET /api/v1/companies/:id/activities
 */
const getCompanyActivities = async (req, res) => {
  try {
    const { id } = req.params;
    const { type } = req.query;

    let whereClause = 'WHERE reference_type = ? AND reference_id = ? AND is_deleted = 0';
    const params = ['company', id];

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
    console.error('Get company activities error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch activities'
    });
  }
};

/**
 * Add activity to company
 * POST /api/v1/companies/:id/activities
 */
const addCompanyActivity = async (req, res) => {
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
        type, description, reference_type, reference_id, company_id,
        created_by, follow_up_at, meeting_link, is_pinned
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        type, description, 'company', id, companyId, userId,
        follow_up_at || null, meeting_link || null, is_pinned || 0
      ]
    );

    res.status(201).json({
      success: true,
      data: { id: result.insertId },
      message: 'Activity added successfully'
    });
  } catch (error) {
    console.error('Add company activity error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add activity'
    });
  }
};

/**
 * Add contact to company
 * POST /api/v1/companies/:id/contacts
 */
const addContact = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, job_title, email, phone, is_primary } = req.body;

    if (!name || !email) {
      return res.status(400).json({
        success: false,
        error: 'Name and email are required'
      });
    }

    // Check if company exists
    const [companies] = await pool.execute(
      `SELECT id FROM companies WHERE id = ? AND is_deleted = 0`,
      [id]
    );

    if (companies.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Company not found'
      });
    }

    // If setting as primary, unset other primary contacts
    if (is_primary) {
      await pool.execute(
        `UPDATE company_contacts SET is_primary = 0 WHERE company_id = ?`,
        [id]
      );
    }

    // Insert contact
    const [result] = await pool.execute(
      `INSERT INTO company_contacts (
        company_id, name, job_title, email, phone, is_primary
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, name, job_title, email, phone, is_primary ? 1 : 0]
    );

    res.status(201).json({
      success: true,
      data: { id: result.insertId },
      message: 'Contact added successfully'
    });
  } catch (error) {
    console.error('Add company contact error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add contact'
    });
  }
};

/**
 * Get company contacts
 * GET /api/v1/companies/:id/contacts
 */
const getContacts = async (req, res) => {
  try {
    const { id } = req.params;

    const [contacts] = await pool.execute(
      `SELECT * FROM company_contacts
       WHERE company_id = ? AND is_deleted = 0
       ORDER BY is_primary DESC, created_at DESC`,
      [id]
    );

    res.json({
      success: true,
      data: contacts
    });
  } catch (error) {
    console.error('Get company contacts error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch contacts'
    });
  }
};

module.exports = {
  getAll,
  getById,
  create,
  update,
  deleteCompany,
  getCompanyWithDetails,
  getCompanyActivities,
  addCompanyActivity,
  addContact,
  getContacts
};

