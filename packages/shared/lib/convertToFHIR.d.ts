/**
 * Request payload for FHIR conversion API
 */
export interface FHIRConversionRequest {
    documentText: string;
    fileName?: string;
    fileType?: string;
}
/**
 * Response payload from FHIR conversion API. POST /convertToFHIR
 */
export interface FHIRConversionResponse {
    resourceType: 'Bundle';
    entry: Array<{
        resource: any;
    }>;
    [key: string]: any;
}
//# sourceMappingURL=convertToFHIR.d.ts.map