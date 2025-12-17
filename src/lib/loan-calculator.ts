
import { differenceInDays, startOfDay } from 'date-fns';
import type { LoanDetails, LoanProduct, PenaltyRule, Tax } from './types';

interface CalculatedRepayment {
    total: number;
    principal: number;
    interest: number;
    penalty: number;
    serviceFee: number;
    tax: number;
}

// Helper to round to 2 decimal places for currency
const roundCurrency = (amount: number): number => {
    return Math.round((amount + Number.EPSILON) * 100) / 100;
};


export const calculateTotalRepayable = (loanDetails: LoanDetails, loanProduct: LoanProduct, taxConfigs: Tax[], asOfDate: Date = new Date()): CalculatedRepayment => {
    const loanStartDate = startOfDay(new Date(loanDetails.disbursedDate));
    const finalDate = startOfDay(asOfDate);
    const dueDate = startOfDay(new Date(loanDetails.dueDate));

    const principal = loanDetails.loanAmount;
    let serviceFee = 0;
    let interestComponent = 0;
    let penaltyComponent = 0;
    let taxComponent = 0;

    // Safely parse JSON fields from the product, as they might be strings from the DB
    const safeParse = (field: any, defaultValue: any) => {
        if (typeof field === 'string') {
            try {
                return JSON.parse(field);
            } catch (e) {
                return defaultValue;
            }
        }
        return field ?? defaultValue;
    };

    const serviceFeeRule = safeParse(loanProduct.serviceFee, undefined);
    const dailyFeeRule = safeParse(loanProduct.dailyFee, undefined);
    const penaltyRules = safeParse(loanProduct.penaltyRules, []);


    // 1. Service Fee (One-time charge)
    if (loanProduct.serviceFeeEnabled && serviceFeeRule && serviceFeeRule.value > 0) {
        const feeValue = typeof serviceFeeRule.value === 'string' ? parseFloat(serviceFeeRule.value) : serviceFeeRule.value;
        if (serviceFeeRule.type === 'fixed') {
            serviceFee = feeValue;
        } else if (serviceFeeRule.type === 'percentage') {
            serviceFee = principal * (feeValue / 100);
        }
    }
    serviceFee = roundCurrency(serviceFee);
    
    // 2. Daily Fee (Interest) - Calculated only up to the due date.
    if (loanProduct.dailyFeeEnabled && dailyFeeRule && dailyFeeRule.value > 0) {
        const feeValue = typeof dailyFeeRule.value === 'string' ? parseFloat(dailyFeeRule.value) : dailyFeeRule.value;
        const interestEndDate = finalDate > dueDate ? dueDate : finalDate;
        const daysForInterest = differenceInDays(interestEndDate, loanStartDate);

        if (daysForInterest > 0) {
            if (dailyFeeRule.type === 'fixed') {
                interestComponent = feeValue * daysForInterest;
            } else if (dailyFeeRule.type === 'percentage') {
                if (dailyFeeRule.calculationBase === 'compound') {
                     let compoundInterestBase = principal;
                    for (let i = 0; i < daysForInterest; i++) {
                        const dailyInterest = roundCurrency(compoundInterestBase * (feeValue / 100));
                        interestComponent += dailyInterest;
                        compoundInterestBase += dailyInterest;
                    }
                } else { // Simple interest on principal
                    interestComponent = principal * (feeValue / 100) * daysForInterest;
                }
            }
        }
    }
    interestComponent = roundCurrency(interestComponent);
    
    const runningBalanceForPenalty = principal + interestComponent + serviceFee;

    // 3. Penalty - Calculated only if overdue.
    if (loanProduct.penaltyRulesEnabled && penaltyRules && penaltyRules.length > 0 && finalDate > dueDate) {
        const penaltyStartDate = loanProduct.duration === 0 ? startOfDay(new Date(loanDetails.disbursedDate.getTime() + 86400000)) : dueDate;
        const daysOverdueTotal = differenceInDays(finalDate, penaltyStartDate);
        
        penaltyRules.forEach((rule: PenaltyRule) => {
             const fromDay = rule.fromDay === '' ? 1 : Number(rule.fromDay);
             const toDayRaw = rule.toDay === '' || rule.toDay === null ? Infinity : Number(rule.toDay);
             const toDay = isNaN(toDayRaw) ? Infinity : toDayRaw;
             const value = rule.value === '' ? 0 : Number(rule.value);

             if (daysOverdueTotal >= fromDay) {
                 const applicableDaysInTier = Math.min(daysOverdueTotal, toDay) - fromDay + 1;
                 const isOneTime = rule.frequency === 'one-time';

                 if (applicableDaysInTier > 0) {
                    let penaltyForThisRule = 0;
                    const daysToCalculate = isOneTime ? 1 : applicableDaysInTier;

                    if (rule.type === 'fixed') {
                        penaltyForThisRule = value * daysToCalculate;
                    } else if (rule.type === 'percentageOfPrincipal') {
                        penaltyForThisRule = principal * (value / 100) * daysToCalculate;
                    } else if (rule.type === 'percentageOfCompound') {
                        let compoundPenaltyBase = runningBalanceForPenalty + penaltyComponent;
                        for (let i = 0; i < daysToCalculate; i++) {
                             const dailyPenalty = roundCurrency(compoundPenaltyBase * (value / 100));
                             penaltyForThisRule += dailyPenalty;
                             if (!isOneTime) {
                                compoundPenaltyBase += dailyPenalty;
                             }
                        }
                    }
                    penaltyComponent += penaltyForThisRule;
                 }
             }
        });
    }
    penaltyComponent = roundCurrency(penaltyComponent);

    // 4. Tax Calculation for all configured taxes
    taxConfigs.forEach(taxConfig => {
        const taxRate = taxConfig.rate;
        const taxAppliedTo = JSON.parse(taxConfig.appliedTo);
        
        if (taxRate > 0) {
            let taxableAmount = 0;
            if (taxAppliedTo.includes('serviceFee')) {
                taxableAmount += serviceFee;
            }
            if (taxAppliedTo.includes('interest')) {
                taxableAmount += interestComponent;
            }
            if (taxAppliedTo.includes('penalty')) {
                taxableAmount += penaltyComponent;
            }
            taxComponent += taxableAmount * (taxRate / 100);
        }
    });
    taxComponent = roundCurrency(taxComponent);

    const totalDebt = roundCurrency(principal + serviceFee + interestComponent + penaltyComponent + taxComponent);

    return {
        total: totalDebt,
        principal: principal,
        serviceFee: serviceFee,
        interest: interestComponent,
        penalty: penaltyComponent,
        tax: taxComponent,
    };
};
