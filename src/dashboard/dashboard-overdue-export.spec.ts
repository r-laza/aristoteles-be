import ExcelJS from 'exceljs';
import {
  overdueStudentsWorkbook,
  type OverdueExportRow,
} from './dashboard-overdue-export';

describe('Overdue student Excel export', () => {
  it('creates typed, formatted cells and removes duplicate students', async () => {
    const row: OverdueExportRow = {
      studentId: 9,
      studentName: 'Ana Pérez',
      dni: '12345678',
      branch: 'Centro',
      cycle: '2027 Escolar',
      group: 'A',
      representativeName: 'Rosa Pérez',
      relationship: 'Madre',
      whatsapp: '',
      outstandingBalance: 850.5,
      overdueBalance: 400.25,
      overdueInstallments: 1,
      nextDueDate: '2027-03-10',
    };
    const content = await overdueStudentsWorkbook([row, { ...row }]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(content);
    const sheet = workbook.getWorksheet('Estudiantes morosos')!;
    expect(sheet.rowCount).toBe(2);
    expect(sheet.getCell('H2').value).toBe('');
    expect(sheet.getCell('I2').value).toBe(850.5);
    expect(sheet.getCell('I2').numFmt).toBe('"S/" #,##0.00');
    expect(sheet.getCell('J2').value).toBe(400.25);
    expect(sheet.getCell('L2').value).toBeInstanceOf(Date);
    expect(sheet.autoFilter).toBe('A1:L1');
  });
});
