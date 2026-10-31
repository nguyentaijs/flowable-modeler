// A DMN task is a bpmn:ServiceTask carrying flowable:type="dmn".
export const isDmnTask = (bo) => !!bo && bo.$type === 'bpmn:ServiceTask' && (bo.get?.('flowable:type') ?? bo.$attrs?.['flowable:type']) === 'dmn';
