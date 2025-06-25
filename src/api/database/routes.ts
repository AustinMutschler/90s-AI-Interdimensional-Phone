import express from 'express';
import { getAllData } from '../../db/databaseClient.js';

const router = express.Router();

router.get('/database', async (req, res) => {
  try {
    const { outboundTable, conditionsTable } = await getAllData();

    // Send HTML with two tables, one for outbound_call_schedule and one for conditions
    return res.status(200).send(`
      <html>
      <head>
      <title>Database Tables</title>
      <style>
        table {
        /* Add borders to everything with no gap */
          border-collapse: collapse;
          width: 100%;
        }
        th, td {
          border: 1px solid black;
          padding: 8px;
          text-align: left;
        }
        th {
          background-color: #f2f2f2;
        }
        tr:nth-child(even) {

          background-color: #f9f9f9;
        }
      </style>
      </head>
      <body>
      <div style="display: flex; justify-content: space-between; flex-direction: column; gap: 2em">
        <table>
          <tr>
            <th>Outbound Call Schedule</th>
          </tr>
          <tr>
            <th>ID</th>
            <th>Character Name</th>
            <th>Condition ID</th>
            <th>Completed</th>
          </tr>
          ${outboundTable.map((row) => `
            <tr>
              <td>${row.id}</td>
              <td>${row.character_name}</td>
              <td>${row.condition_id}</td>
              <td>${row.completed}</td>
            </tr>`).join('')}
        </table>

        <table>
          <tr>
            <th>Conditions</th>
          </tr>
          <tr>
            <th>ID</th>
            <th>Value</th>
          </tr>
          ${conditionsTable.map((row) => `
            <tr>
              <td>${row.id}</td>
              <td>${row.value}</td>
            </tr>`).join('')}
        </table>
        </div>
      </body>
      </html>`);

  } catch (error) {
    console.error("Error in /database route:", error);
    return res.status(500).send("Internal Server Error");
  }
});

export default router;