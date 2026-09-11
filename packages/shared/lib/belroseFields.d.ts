export interface BelroseFields {
    visitType: string;
    title: string;
    summary: string;
    completedDate: string;
    provider: string;
    institution: string;
    patient: string;
    detailedNarrative: string;
}
/**
 * Request payload for Belrose Fields processing
 */
export interface BelroseFieldProcessingRequest {
    fhirData: any;
    extractedText?: string;
    originalText?: string;
    fileName?: string;
    contextText?: string;
}
//# sourceMappingURL=belroseFields.d.ts.map