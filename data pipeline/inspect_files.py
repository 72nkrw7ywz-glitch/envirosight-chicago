import pandas as pd

acs_path = "../data/raw/ACS_5_Year_Data_by_Community_Area_20260512.csv"

acs = pd.read_csv(acs_path)

print("ACS FILE COLUMNS:")
print(list(acs.columns))

print("\nFIRST 5 ROWS:")
print(acs.head())