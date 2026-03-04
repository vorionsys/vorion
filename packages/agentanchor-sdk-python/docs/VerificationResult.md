# VerificationResult


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**verified** | **bool** |  | [optional] 
**chain_valid** | **bool** | Whether chain integrity is intact | [optional] 
**record** | [**TruthChainRecord**](TruthChainRecord.md) |  | [optional] 
**verification_url** | **str** |  | [optional] 

## Example

```python
from agentanchor.models.verification_result import VerificationResult

# TODO update the JSON string below
json = "{}"
# create an instance of VerificationResult from a JSON string
verification_result_instance = VerificationResult.from_json(json)
# print the JSON string representation of the object
print(VerificationResult.to_json())

# convert the object into a dict
verification_result_dict = verification_result_instance.to_dict()
# create an instance of VerificationResult from a dict
verification_result_from_dict = VerificationResult.from_dict(verification_result_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


