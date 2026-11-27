import ExcelJS from 'exceljs';

export type OverdueExportRow = {
  studentId: number;
  studentName: string;
  dni: string;
  branch: string;
  cycle: string;
  group: string;
  representativeName: string;
  relationship: string;
  whatsapp: string;
  outstandingBalance: number;
  overdueBalance: number;
  overdueInstallments: number;
  nextDueDate: string | null;
};

export async function overdueStudentsWorkbook(rows: OverdueExportRow[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Aristóteles';
  const sheet = workbook.addWorksheet('Estudiantes morosos', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  sheet.columns = [
    { header: 'Estudiante', key: 'studentName', width: 30 },
    { header: 'DNI', key: 'dni', width: 16 },
    { header: 'Sede', key: 'branch', width: 20 },
    { header: 'Ciclo académico', key: 'cycle', width: 22 },
    { header: 'Grupo', key: 'group', width: 18 },
    { header: 'Representante', key: 'representativeName', width: 30 },
    { header: 'Parentesco', key: 'relationship', width: 18 },
    { header: 'WhatsApp', key: 'whatsapp', width: 18 },
    { header: 'Saldo pendiente', key: 'outstandingBalance', width: 18 },
    { header: 'Saldo vencido', key: 'overdueBalance', width: 18 },
    { header: 'Cuotas vencidas', key: 'overdueInstallments', width: 17 },
    { header: 'Próximo vencimiento', key: 'nextDueDate', width: 22 },
  ];
  const uniqueRows = [
    ...new Map(rows.map((row) => [row.studentId, row])).values(),
  ];
  for (const row of uniqueRows) {
    sheet.addRow({
      ...row,
      nextDueDate: row.nextDueDate
        ? new Date(`${row.nextDueDate}T00:00:00.000Z`)
        : null,
    });
  }
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF075985' },
    };
    cell.alignment = { vertical: 'middle' };
  });
  sheet.getColumn('outstandingBalance').numFmt = '"S/" #,##0.00';
  sheet.getColumn('overdueBalance').numFmt = '"S/" #,##0.00';
  sheet.getColumn('nextDueDate').numFmt = 'dd/mm/yyyy';
  sheet.autoFilter = { from: 'A1', to: 'L1' };
  return workbook.xlsx.writeBuffer();
}
