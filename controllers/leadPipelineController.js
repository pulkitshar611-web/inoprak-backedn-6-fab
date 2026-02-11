// =====================================================
// Lead Pipeline & Stages Controller (configurable from Settings)
// =====================================================

const pool = require('../config/db');

const getCompanyId = (req) => req.query.company_id || req.body.company_id || req.user?.company_id;

// ---------- Pipelines ----------
const getAllPipelines = async (req, res) => {
  try {
    const company_id = getCompanyId(req);
    if (!company_id) return res.status(400).json({ success: false, error: 'company_id is required' });

    const [rows] = await pool.execute(
      `SELECT * FROM lead_pipelines WHERE company_id = ? AND (is_deleted = 0 OR is_deleted IS NULL) ORDER BY is_default DESC, name ASC`,
      [company_id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Lead pipelines getAll:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch lead pipelines' });
  }
};

const createPipeline = async (req, res) => {
  try {
    const company_id = getCompanyId(req);
    if (!company_id) return res.status(400).json({ success: false, error: 'company_id is required' });

    const { name, is_default } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'name is required' });

    if (is_default) {
      await pool.execute('UPDATE lead_pipelines SET is_default = 0 WHERE company_id = ?', [company_id]);
    }
    const [result] = await pool.execute(
      'INSERT INTO lead_pipelines (company_id, name, is_default) VALUES (?, ?, ?)',
      [company_id, name, is_default ? 1 : 0]
    );
    res.status(201).json({ success: true, data: { id: result.insertId, name, is_default: !!is_default } });
  } catch (err) {
    console.error('Lead pipeline create:', err);
    res.status(500).json({ success: false, error: 'Failed to create lead pipeline' });
  }
};

const updatePipeline = async (req, res) => {
  try {
    const { id } = req.params;
    const company_id = getCompanyId(req);
    const { name, is_default } = req.body;

    if (is_default) {
      await pool.execute('UPDATE lead_pipelines SET is_default = 0 WHERE company_id = ?', [company_id]);
    }
    const [result] = await pool.execute(
      'UPDATE lead_pipelines SET name = COALESCE(?, name), is_default = COALESCE(?, is_default) WHERE id = ? AND company_id = ?',
      [name ?? null, is_default !== undefined ? (is_default ? 1 : 0) : null, id, company_id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ success: false, error: 'Pipeline not found' });
    res.json({ success: true, data: { id, updated: true } });
  } catch (err) {
    console.error('Lead pipeline update:', err);
    res.status(500).json({ success: false, error: 'Failed to update lead pipeline' });
  }
};

const deletePipeline = async (req, res) => {
  try {
    const { id } = req.params;
    const company_id = getCompanyId(req);
    const [result] = await pool.execute('UPDATE lead_pipelines SET is_deleted = 1 WHERE id = ? AND company_id = ?', [id, company_id]);
    if (result.affectedRows === 0) return res.status(404).json({ success: false, error: 'Pipeline not found' });
    res.json({ success: true, data: { id, deleted: true } });
  } catch (err) {
    console.error('Lead pipeline delete:', err);
    res.status(500).json({ success: false, error: 'Failed to delete lead pipeline' });
  }
};

// ---------- Stages ----------
const getStagesByPipelineId = async (req, res) => {
  try {
    const { pipeline_id } = req.params;
    const [rows] = await pool.execute(
      `SELECT * FROM lead_pipeline_stages WHERE pipeline_id = ? AND (is_deleted = 0 OR is_deleted IS NULL) ORDER BY display_order ASC, name ASC`,
      [pipeline_id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Lead stages getByPipeline:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch stages' });
  }
};

const createStage = async (req, res) => {
  try {
    const { pipeline_id } = req.params;
    const { name, display_order, color } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'name is required' });

    const order = display_order ?? 0;
    const [result] = await pool.execute(
      'INSERT INTO lead_pipeline_stages (pipeline_id, name, display_order, color) VALUES (?, ?, ?, ?)',
      [pipeline_id, name, order, color || '#3B82F6']
    );
    res.status(201).json({ success: true, data: { id: result.insertId, pipeline_id, name, display_order: order, color: color || '#3B82F6' } });
  } catch (err) {
    console.error('Lead stage create:', err);
    res.status(500).json({ success: false, error: 'Failed to create stage' });
  }
};

const updateStage = async (req, res) => {
  try {
    const { pipeline_id, stage_id } = req.params;
    const { name, display_order, color } = req.body;

    const [result] = await pool.execute(
      'UPDATE lead_pipeline_stages SET name = COALESCE(?, name), display_order = COALESCE(?, display_order), color = COALESCE(?, color) WHERE id = ? AND pipeline_id = ?',
      [name ?? null, display_order ?? null, color ?? null, stage_id, pipeline_id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ success: false, error: 'Stage not found' });
    res.json({ success: true, data: { id: stage_id, updated: true } });
  } catch (err) {
    console.error('Lead stage update:', err);
    res.status(500).json({ success: false, error: 'Failed to update stage' });
  }
};

const deleteStage = async (req, res) => {
  try {
    const { pipeline_id, stage_id } = req.params;
    const [result] = await pool.execute(
      'UPDATE lead_pipeline_stages SET is_deleted = 1 WHERE id = ? AND pipeline_id = ?',
      [stage_id, pipeline_id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ success: false, error: 'Stage not found' });
    res.json({ success: true, data: { id: stage_id, deleted: true } });
  } catch (err) {
    console.error('Lead stage delete:', err);
    res.status(500).json({ success: false, error: 'Failed to delete stage' });
  }
};

const reorderStages = async (req, res) => {
  try {
    const { pipeline_id } = req.params;
    const { stages } = req.body; // Array of { id, display_order }

    if (!Array.isArray(stages)) {
      return res.status(400).json({ success: false, error: 'stages array is required' });
    }

    const queries = stages.map(s =>
      pool.execute('UPDATE lead_pipeline_stages SET display_order = ? WHERE id = ? AND pipeline_id = ?', [s.display_order, s.id, pipeline_id])
    );

    await Promise.all(queries);

    res.json({ success: true, message: 'Stages reordered successfully' });
  } catch (err) {
    console.error('Lead stage reorder:', err);
    res.status(500).json({ success: false, error: 'Failed to reorder stages' });
  }
};

module.exports = {
  getAllPipelines,
  createPipeline,
  updatePipeline,
  deletePipeline,
  getStagesByPipelineId,
  createStage,
  updateStage,
  deleteStage,
  reorderStages
};
