import { MMELRecord } from '../types/dispatch';

export const mmelRecords: MMELRecord[] = [
  {
    recordId: 'atr72-elt-001',
    aircraft: 'ATR72',
    aircraftAliases: ['ATR 72', 'ATR72-600'],
    equipmentName: 'Fixed Emergency Locator Transmitter (ELT)',
    keywords: ['elt', 'emergency locator transmitter', 'missing', 'placard'],
    installed: 1,
    requiredForDispatch: 0,
    placardRequired: true,
    repairInterval: 'Repair within the operator MEL interval required by local regulation.',
    conditions: [
      'Placard must be installed and visible to the crew.',
      'Missing or inoperative equipment must be recorded in maintenance documentation.'
    ],
    limitations: [
      'Dispatch is only acceptable under the approved MEL item wording.',
      'Repair interval tracking must be active from time of release.'
    ],
    summaryTemplate: 'Dispatch may be allowed because the equipment count required for dispatch is zero, provided placarding and repair interval controls are in place.',
    manualPage: {
      mimeType: 'image/jpeg',
      base64: '/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEBUQEBAVFRUVFRUVFRUVFRUVFRUQFhUXFhUVFRUYHSggGBolHRUVITEhJSkrLi4uFx8zODMsNygtLisBCgoKDg0OGxAQGy0fICUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAoACgMBIgACEQEDEQH/xAAXAAEBAQEAAAAAAAAAAAAAAAAAAQID/8QAFxEBAQEBAAAAAAAAAAAAAAAAAQIAEf/aAAwDAQACEAMQAAAB6iAAAAAAAAAAAP/EABgQAQEAAwAAAAAAAAAAAAAAAAERAhIh/9oACAEBAAEFAvK1a//EABYRAQEBAAAAAAAAAAAAAAAAAAABEf/aAAgBAwEBPwGn/8QAFhEBAQEAAAAAAAAAAAAAAAAAABEB/9oACAECAQE/AYf/xAAZEAEBAQEBAQAAAAAAAAAAAAABEQAhMUH/2gAIAQEABj8CtadYb//EABkQAQEAAwEAAAAAAAAAAAAAAAERACExQf/aAAgBAQABPyFq7pJLiHq0n//aAAwDAQACAAMAAAAQ8//EABcRAQEBAQAAAAAAAAAAAAAAAAEREDH/2gAIAQMBAT8QqUf/xAAXEQEBAQEAAAAAAAAAAAAAAAABABEx/9oACAECAQE/EKtm/8QAGxABAQADAQEBAAAAAAAAAAERACExQVFhcaH/2gAIAQEAAT8QGkGfVsCthg8I4Eg0kkq2Z0//2Q=='
    }
  },
  {
    recordId: 'b737max-pack-001',
    aircraft: 'Boeing 737 MAX',
    aircraftAliases: ['737 MAX', 'B737 MAX', 'Boeing 737MAX'],
    equipmentName: 'Air Conditioning Pack',
    keywords: ['air conditioning', 'pack', 'pack inoperative', 'environmental control system'],
    installed: 2,
    requiredForDispatch: 1,
    placardRequired: true,
    repairInterval: 'Repair interval must be initiated at dispatch release in accordance with operator MEL category.',
    conditions: [
      'The remaining pack must be operational.',
      'Applicable placards and logbook entries must be completed.',
      'Crew must be informed of any associated operating procedures.'
    ],
    limitations: [
      'Environmental performance limitations may apply.',
      'Cabin comfort and route limitations should be communicated to dispatch and crew.'
    ],
    summaryTemplate: 'Dispatch is conditionally permitted with one pack inoperative if the remaining pack is working and procedural requirements are completed.',
    manualPage: {
      mimeType: 'image/jpeg',
      base64: '/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEBUQEBAVFRUVFRUVFRUVFRUVFRUQFhUXFhUVFRUYHSggGBolHRUVITEhJSkrLi4uFx8zODMsNygtLisBCgoKDg0OGxAQGy0fICUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAoACgMBIgACEQEDEQH/xAAXAAEBAQEAAAAAAAAAAAAAAAAAAQID/8QAFxEBAQEBAAAAAAAAAAAAAAAAAQIAEf/aAAwDAQACEAMQAAAB6iAAAAAAAAAAAP/EABgQAQEAAwAAAAAAAAAAAAAAAAERAhIh/9oACAEBAAEFAvK1a//EABYRAQEBAAAAAAAAAAAAAAAAAAABEf/aAAgBAwEBPwGn/8QAFhEBAQEAAAAAAAAAAAAAAAAAABEB/9oACAECAQE/AYf/xAAZEAEBAQEBAQAAAAAAAAAAAAABEQAhMUH/2gAIAQEABj8CtadYb//EABkQAQEAAwEAAAAAAAAAAAAAAAERACExQf/aAAgBAQABPyFq7pJLiHq0n//aAAwDAQACAAMAAAAQ8//EABcRAQEBAQAAAAAAAAAAAAAAAAEREDH/2gAIAQMBAT8QqUf/xAAXEQEBAQEAAAAAAAAAAAAAAAABABEx/9oACAECAQE/EKtm/8QAGxABAQADAQEBAAAAAAAAAAERACExQVFhcaH/2gAIAQEAAT8QGkGfVsCthg8I4Eg0kkq2Z0//2Q=='
    }
  },
  {
    recordId: 'a320-nav-display-001',
    aircraft: 'Airbus A320',
    aircraftAliases: ['A320', 'Airbus 320'],
    equipmentName: 'Navigation Display',
    keywords: ['navigation display', 'display', 'nd', 'screen inoperative'],
    installed: 2,
    requiredForDispatch: 1,
    placardRequired: true,
    repairInterval: 'Repair within the approved MEL interval.',
    conditions: [
      'One display must remain available to the operating crew.',
      'Crew procedures must be observed before release.'
    ],
    limitations: [
      'Any operational limitation in the MEL must be applied.'
    ],
    summaryTemplate: 'Dispatch is likely allowed with one navigation display inoperative if one remains available and the MEL operating procedures are completed.',
    manualPage: {
      mimeType: 'image/jpeg',
      base64: '/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEBUQEBAVFRUVFRUVFRUVFRUVFRUQFhUXFhUVFRUYHSggGBolHRUVITEhJSkrLi4uFx8zODMsNygtLisBCgoKDg0OGxAQGy0fICUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAoACgMBIgACEQEDEQH/xAAXAAEBAQEAAAAAAAAAAAAAAAAAAQID/8QAFxEBAQEBAAAAAAAAAAAAAAAAAQIAEf/aAAwDAQACEAMQAAAB6iAAAAAAAAAAAP/EABgQAQEAAwAAAAAAAAAAAAAAAAERAhIh/9oACAEBAAEFAvK1a//EABYRAQEBAAAAAAAAAAAAAAAAAAABEf/aAAgBAwEBPwGn/8QAFhEBAQEAAAAAAAAAAAAAAAAAABEB/9oACAECAQE/AYf/xAAZEAEBAQEBAQAAAAAAAAAAAAABEQAhMUH/2gAIAQEABj8CtadYb//EABkQAQEAAwEAAAAAAAAAAAAAAAERACExQf/aAAgBAQABPyFq7pJLiHq0n//aAAwDAQACAAMAAAAQ8//EABcRAQEBAQAAAAAAAAAAAAAAAAEREDH/2gAIAQMBAT8QqUf/xAAXEQEBAQEAAAAAAAAAAAAAAAABABEx/9oACAECAQE/EKtm/8QAGxABAQADAQEBAAAAAAAAAAERACExQVFhcaH/2gAIAQEAAT8QGkGfVsCthg8I4Eg0kkq2Z0//2Q=='
    }
  },
  {
    recordId: 'emb145-antiskid-001',
    aircraft: 'Embraer EMB-145',
    aircraftAliases: ['EMB-145', 'ERJ-145', 'Embraer 145'],
    equipmentName: 'Anti-Skid System',
    keywords: ['anti-skid', 'antiskid', 'braking fault', 'fault'],
    installed: 1,
    requiredForDispatch: 1,
    placardRequired: false,
    repairInterval: 'Immediate review required before release.',
    conditions: [
      'If anti-skid dispatch relief is not available in the MEL item, release is not permitted.'
    ],
    limitations: [
      'Additional landing performance and braking limitations may apply.'
    ],
    summaryTemplate: 'This issue requires higher scrutiny because braking-related systems may not have dispatch relief under all conditions.',
    manualPage: {
      mimeType: 'image/jpeg',
      base64: '/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEBUQEBAVFRUVFRUVFRUVFRUVFRUQFhUXFhUVFRUYHSggGBolHRUVITEhJSkrLi4uFx8zODMsNygtLisBCgoKDg0OGxAQGy0fICUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAoACgMBIgACEQEDEQH/xAAXAAEBAQEAAAAAAAAAAAAAAAAAAQID/8QAFxEBAQEBAAAAAAAAAAAAAAAAAQIAEf/aAAwDAQACEAMQAAAB6iAAAAAAAAAAAP/EABgQAQEAAwAAAAAAAAAAAAAAAAERAhIh/9oACAEBAAEFAvK1a//EABYRAQEBAAAAAAAAAAAAAAAAAAABEf/aAAgBAwEBPwGn/8QAFhEBAQEAAAAAAAAAAAAAAAAAABEB/9oACAECAQE/AYf/xAAZEAEBAQEBAQAAAAAAAAAAAAABEQAhMUH/2gAIAQEABj8CtadYb//EABkQAQEAAwEAAAAAAAAAAAAAAAERACExQf/aAAgBAQABPyFq7pJLiHq0n//aAAwDAQACAAMAAAAQ8//EABcRAQEBAQAAAAAAAAAAAAAAAAEREDH/2gAIAQMBAT8QqUf/xAAXEQEBAQEAAAAAAAAAAAAAAAABABEx/9oACAECAQE/EKtm/8QAGxABAQADAQEBAAAAAAAAAAERACExQVFhcaH/2gAIAQEAAT8QGkGfVsCthg8I4Eg0kkq2Z0//2Q=='
    }
  }
];