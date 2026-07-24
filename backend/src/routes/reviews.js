import express from 'express';
import { query } from '../db.js';
import { verifyPatient } from '../middleware/auth.js';
import { v4 as uuidv4 } from 'uuid';
import { invalidatePattern } from '../redis.js';

const router = express.Router();

// Post review
router.post('/', verifyPatient, async (req, res) => {
  try {
    const { doctor_id, rating, comment } = req.body;
    const patient_id = req.user.id;

    if (!doctor_id || !rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Invalid rating or missing fields' });
    }

    // Check if patient has appointment with doctor
    const appointmentCheck = await query(
      `SELECT id FROM appointments 
       WHERE patient_id = $1 AND doctor_id = $2 AND status = 'completed'`,
      [patient_id, doctor_id]
    );

    if (appointmentCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Can only review completed appointments' });
    }

    const reviewId = uuidv4();

    const result = await query(
      `INSERT INTO reviews (id, doctor_id, patient_id, rating, comment, verified, created_at)
       VALUES ($1, $2, $3, $4, $5, false, NOW())
       RETURNING *`,
      [reviewId, doctor_id, patient_id, rating, comment]
    );

    // Invalidate doctor cache
    await invalidatePattern(`doctor:${doctor_id}*`);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to post review' });
  }
});

// Get doctor reviews
router.get('/doctor/:doctor_id', async (req, res) => {
  try {
    const { doctor_id } = req.params;
    const { limit = 10, offset = 0 } = req.query;

    const result = await query(
      `SELECT 
        r.id, r.rating, r.comment, r.created_at, r.verified,
        u.name as patient_name
      FROM reviews r
      JOIN users u ON r.patient_id = u.id
      WHERE r.doctor_id = $1 AND r.verified = true
      ORDER BY r.created_at DESC
      LIMIT $2 OFFSET $3`,
      [doctor_id, limit, offset]
    );

    res.json({ reviews: result.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

export default router;
