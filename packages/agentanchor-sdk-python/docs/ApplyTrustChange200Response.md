# ApplyTrustChange200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**previous_score** | **int** |  | [optional] 
**new_score** | **int** |  | [optional] 
**previous_tier** | **str** |  | [optional] 
**new_tier** | **str** |  | [optional] 
**tier_changed** | **bool** |  | [optional] 

## Example

```python
from agentanchor.models.apply_trust_change200_response import ApplyTrustChange200Response

# TODO update the JSON string below
json = "{}"
# create an instance of ApplyTrustChange200Response from a JSON string
apply_trust_change200_response_instance = ApplyTrustChange200Response.from_json(json)
# print the JSON string representation of the object
print(ApplyTrustChange200Response.to_json())

# convert the object into a dict
apply_trust_change200_response_dict = apply_trust_change200_response_instance.to_dict()
# create an instance of ApplyTrustChange200Response from a dict
apply_trust_change200_response_from_dict = ApplyTrustChange200Response.from_dict(apply_trust_change200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


